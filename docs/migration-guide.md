# Migrating Your Project to the Portfolio Platform

This guide walks you through deploying an existing containerized application onto the shared portfolio infrastructure (VPC, ALB, ECS Fargate, Route53, optional RDS) hosted at `cwnel.com`.

---

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Docker](https://www.docker.com/)
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- AWS credentials configured (`aws configure` or environment variables)
- A Pulumi account (the platform stack lives under the `Cwnelson215` org)

---

## 1. App Contract

Your container **must** satisfy two requirements:

1. **Listen on port 3000** (or whatever you configure as `containerPort`)
2. **Expose `GET /health`** returning HTTP `200` when healthy

The ALB target group and ECS container health check both hit this endpoint. If your app doesn't have a `/health` route yet, add one before proceeding.

---

## 2. Add a Dockerfile

If you don't already have one, create a `Dockerfile` in your project root.

### Node.js / Express / Fastify / etc.

```dockerfile
# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Static site (React, Vite, etc.) with nginx

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

With `nginx.conf`:

```nginx
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    location /health {
        access_log off;
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 3. Add Pulumi Infrastructure

Create these files in your project root (alongside your existing source code).

### `Pulumi.yaml`

```yaml
name: YOUR-APP-NAME
runtime: nodejs
description: YOUR-APP-NAME deployed on the portfolio platform
```

### `Pulumi.dev.yaml`

```yaml
config:
  aws:region: us-east-1
  YOUR-APP-NAME:appName: YOUR-APP-NAME
  YOUR-APP-NAME:subdomain: YOUR-SUBDOMAIN
  YOUR-APP-NAME:platformStack: Cwnelson215/portfolio-platform/dev
  YOUR-APP-NAME:cpu: "256"
  YOUR-APP-NAME:memory: "512"
  YOUR-APP-NAME:desiredCount: "1"
  YOUR-APP-NAME:containerPort: "3000"
  YOUR-APP-NAME:useFargateSpot: "true"
```

Replace `YOUR-APP-NAME` and `YOUR-SUBDOMAIN` throughout. The subdomain becomes `YOUR-SUBDOMAIN.cwnel.com`.

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["./*.ts"],
  "exclude": ["node_modules", "src"]
}
```

### `index.ts`

This is the Pulumi infrastructure code. Copy it as-is.

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// =============================================================================
// Configuration
// =============================================================================

const config = new pulumi.Config();
const appName = config.require("appName");
const subdomain = config.require("subdomain");
const platformStackName = config.require("platformStack");

const cpu = parseInt(config.get("cpu") || "256");
const memory = parseInt(config.get("memory") || "512");
const desiredCount = parseInt(config.get("desiredCount") || "1");
const containerPort = parseInt(config.get("containerPort") || "3000");
const useFargateSpot = config.getBoolean("useFargateSpot") ?? true;

// Scheduled scaling (optional)
const enableScheduledScaling = config.getBoolean("enableScheduledScaling") ?? false;
const scaleUpHour = parseInt(config.get("scaleUpHour") || "6");
const scaleDownHour = parseInt(config.get("scaleDownHour") || "22");
const scheduleTimezone = config.get("scheduleTimezone") || "America/Denver";

// =============================================================================
// Import Platform Stack Outputs
// =============================================================================

const platformStack = new pulumi.StackReference(platformStackName);

const vpcId = platformStack.getOutput("vpcId") as pulumi.Output<string>;
const publicSubnetIds = platformStack.getOutput("publicSubnetIds") as pulumi.Output<string[]>;
const defaultSecurityGroupId = platformStack.getOutput("defaultSecurityGroupId") as pulumi.Output<string>;

const clusterArn = platformStack.getOutput("clusterArn") as pulumi.Output<string>;
const clusterName = platformStack.getOutput("clusterName") as pulumi.Output<string>;
const taskExecutionRoleArn = platformStack.getOutput("taskExecutionRoleArn") as pulumi.Output<string>;
const taskRoleArn = platformStack.getOutput("taskRoleArn") as pulumi.Output<string>;

const httpsListenerArn = platformStack.getOutput("httpsListenerArn") as pulumi.Output<string>;
const albSecurityGroupId = platformStack.getOutput("albSecurityGroupId") as pulumi.Output<string>;
const albDnsName = platformStack.getOutput("albDnsName") as pulumi.Output<string>;
const domainName = platformStack.getOutput("domainName") as pulumi.Output<string>;

const logGroupName = platformStack.getOutput("logGroupName") as pulumi.Output<string>;
const region = platformStack.getOutput("region") as pulumi.Output<string>;

// Optional database
const dbEndpoint = platformStack.getOutput("dbEndpoint") as pulumi.Output<string | undefined>;
const dbPasswordSecretArn = platformStack.getOutput("dbPasswordSecretArn") as pulumi.Output<string | undefined>;

// =============================================================================
// Tags
// =============================================================================

const tags = {
  Project: "portfolio",
  App: appName,
  ManagedBy: "pulumi",
};

// =============================================================================
// ECR Repository
// =============================================================================

const ecrRepo = new aws.ecr.Repository(`${appName}-repo`, {
  name: `portfolio/${appName}`,
  imageTagMutability: "MUTABLE",
  imageScanningConfiguration: { scanOnPush: true },
  tags,
});

new aws.ecr.LifecyclePolicy(`${appName}-lifecycle`, {
  repository: ecrRepo.name,
  policy: JSON.stringify({
    rules: [{
      rulePriority: 1,
      description: "Keep last 10 images",
      selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 10 },
      action: { type: "expire" },
    }],
  }),
});

// =============================================================================
// Security Group
// =============================================================================

const appSg = new aws.ec2.SecurityGroup(`${appName}-sg`, {
  vpcId,
  description: `Security group for ${appName}`,
  ingress: [{
    protocol: "tcp",
    fromPort: containerPort,
    toPort: containerPort,
    securityGroups: [albSecurityGroupId],
    description: "Allow traffic from ALB",
  }],
  egress: [{
    protocol: "-1",
    fromPort: 0,
    toPort: 0,
    cidrBlocks: ["0.0.0.0/0"],
  }],
  tags: { ...tags, Name: `${appName}-sg` },
});

// =============================================================================
// ALB Target Group + Listener Rule
// =============================================================================

const targetGroup = new aws.lb.TargetGroup(`${appName}-tg`, {
  port: containerPort,
  protocol: "HTTP",
  vpcId,
  targetType: "ip",
  healthCheck: {
    enabled: true,
    path: "/health",
    healthyThreshold: 2,
    unhealthyThreshold: 3,
    timeout: 5,
    interval: 30,
    matcher: "200",
  },
  deregistrationDelay: 30,
  tags,
});

const fullHostname = pulumi.interpolate`${subdomain}.${domainName}`;

const listenerRule = new aws.lb.ListenerRule(`${appName}-rule`, {
  listenerArn: httpsListenerArn,
  priority: pulumi.output(subdomain).apply((s) => {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash % 49000) + 1000;
  }),
  conditions: [{ hostHeader: { values: [fullHostname] } }],
  actions: [{ type: "forward", targetGroupArn: targetGroup.arn }],
  tags,
});

// =============================================================================
// ECS Task Definition
// =============================================================================

const containerEnv = [
  { name: "NODE_ENV", value: "production" },
  { name: "PORT", value: containerPort.toString() },
];

const taskDefinition = new aws.ecs.TaskDefinition(`${appName}-task`, {
  family: appName,
  cpu: cpu.toString(),
  memory: memory.toString(),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: taskExecutionRoleArn,
  taskRoleArn: taskRoleArn,
  containerDefinitions: pulumi
    .all([ecrRepo.repositoryUrl, logGroupName, region, dbEndpoint, dbPasswordSecretArn])
    .apply(([repoUrl, logGroup, awsRegion, dbHost, dbSecretArn]) => {
      const env = [...containerEnv];
      const secrets: { name: string; valueFrom: string }[] = [];

      if (dbHost) {
        env.push({ name: "DB_HOST", value: dbHost.split(":")[0] });
        env.push({ name: "DB_PORT", value: "5432" });
        env.push({ name: "DB_NAME", value: appName.replace(/-/g, "_") });
        env.push({ name: "DB_USER", value: "portfolio_admin" });
      }
      if (dbSecretArn) {
        secrets.push({ name: "DB_PASSWORD", valueFrom: dbSecretArn });
      }

      return JSON.stringify([{
        name: appName,
        image: `${repoUrl}:latest`,
        essential: true,
        portMappings: [{ containerPort, protocol: "tcp" }],
        environment: env,
        secrets: secrets.length > 0 ? secrets : undefined,
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroup,
            "awslogs-region": awsRegion,
            "awslogs-stream-prefix": appName,
          },
        },
        healthCheck: {
          command: ["CMD-SHELL", `curl -f http://localhost:${containerPort}/health || exit 1`],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 60,
        },
      }]);
    }),
  tags,
});

// =============================================================================
// ECS Service
// =============================================================================

const service = new aws.ecs.Service(`${appName}-service`, {
  name: appName,
  cluster: clusterArn,
  taskDefinition: taskDefinition.arn,
  desiredCount,
  launchType: useFargateSpot ? undefined : "FARGATE",
  capacityProviderStrategies: useFargateSpot
    ? [
        { capacityProvider: "FARGATE_SPOT", weight: 1, base: 0 },
        { capacityProvider: "FARGATE", weight: 0, base: 1 },
      ]
    : undefined,
  networkConfiguration: {
    subnets: publicSubnetIds,
    securityGroups: [appSg.id, defaultSecurityGroupId],
    assignPublicIp: true,
  },
  loadBalancers: [{
    targetGroupArn: targetGroup.arn,
    containerName: appName,
    containerPort,
  }],
  deploymentMinimumHealthyPercent: 50,
  deploymentMaximumPercent: 200,
  propagateTags: "SERVICE",
  healthCheckGracePeriodSeconds: 60,
  tags,
});

// =============================================================================
// Scheduled Scaling (optional)
// =============================================================================

if (enableScheduledScaling) {
  const scalingTarget = new aws.appautoscaling.Target(`${appName}-scaling-target`, {
    maxCapacity: desiredCount,
    minCapacity: 0,
    resourceId: pulumi.interpolate`service/${clusterArn.apply(arn => arn.split('/').pop())}/${service.name}`,
    scalableDimension: "ecs:service:DesiredCount",
    serviceNamespace: "ecs",
  });

  new aws.appautoscaling.ScheduledAction(`${appName}-scale-up`, {
    name: `${appName}-scale-up`,
    serviceNamespace: scalingTarget.serviceNamespace,
    resourceId: scalingTarget.resourceId,
    scalableDimension: scalingTarget.scalableDimension,
    schedule: `cron(0 ${scaleUpHour} * * ? *)`,
    timezone: scheduleTimezone,
    scalableTargetAction: { minCapacity: desiredCount, maxCapacity: desiredCount },
  });

  new aws.appautoscaling.ScheduledAction(`${appName}-scale-down`, {
    name: `${appName}-scale-down`,
    serviceNamespace: scalingTarget.serviceNamespace,
    resourceId: scalingTarget.resourceId,
    scalableDimension: scalingTarget.scalableDimension,
    schedule: `cron(0 ${scaleDownHour} * * ? *)`,
    timezone: scheduleTimezone,
    scalableTargetAction: { minCapacity: 0, maxCapacity: 0 },
  });
}

// =============================================================================
// Outputs
// =============================================================================

export const appUrl = pulumi.interpolate`https://${subdomain}.${domainName}`;
export const albUrl = pulumi.interpolate`http://${albDnsName}`;
export const ecrRepositoryUrl = ecrRepo.repositoryUrl;
export const serviceName = service.name;
export const serviceArn = service.id;
```

---

## 4. Install Pulumi Dependencies

Add these to your existing `package.json` (or create a separate infra `package.json`):

```bash
npm install --save @pulumi/aws @pulumi/pulumi
npm install --save-dev @types/node typescript
```

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "preview": "pulumi preview",
    "up": "pulumi up",
    "destroy": "pulumi destroy"
  }
}
```

---

## 5. Initialize and Deploy

```bash
# Initialize the Pulumi stack
pulumi stack init YOUR-APP-NAME-dev

# Preview what will be created
pulumi preview

# Deploy
pulumi up
```

On first deploy, Pulumi creates: an ECR repo, security group, ALB target group, listener rule, ECS task definition, and ECS service. The service will fail to start until you push a Docker image.

---

## 6. Push Your First Docker Image

```bash
# Get your ECR repo URL from Pulumi outputs
ECR_URL=$(pulumi stack output ecrRepositoryUrl)

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$ECR_URL"

# Build and push
docker build -t "$ECR_URL:latest" .
docker push "$ECR_URL:latest"

# Force the ECS service to pick up the new image
aws ecs update-service \
  --cluster portfolio-dev-cluster \
  --service YOUR-APP-NAME \
  --force-new-deployment
```

Your app will be live at `https://YOUR-SUBDOMAIN.cwnel.com` once the task starts and passes health checks (usually ~1-2 minutes).

---

## 7. Set Up CI/CD (GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'dev'
        type: choice
        options:
          - dev
          - prod

env:
  AWS_REGION: us-east-1

jobs:
  build-and-deploy:
    name: Build and Deploy
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Install dependencies
        run: npm ci

      - name: Get app name from Pulumi config
        id: app-info
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
        run: |
          APP_NAME=$(pulumi config get appName --stack ${{ github.event.inputs.environment || 'dev' }})
          echo "app-name=$APP_NAME" >> $GITHUB_OUTPUT

      - name: Get ECR Repository URL
        id: ecr-url
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
        run: |
          STACK="${{ steps.app-info.outputs.app-name }}-${{ github.event.inputs.environment || 'dev' }}"
          ECR_URL=$(pulumi stack output ecrRepositoryUrl --stack "$STACK" 2>/dev/null || echo "")
          if [ -z "$ECR_URL" ]; then
            echo "ECR repository not found. Running pulumi up first..."
            pulumi up --yes --stack "$STACK"
            ECR_URL=$(pulumi stack output ecrRepositoryUrl --stack "$STACK")
          fi
          echo "ecr-url=$ECR_URL" >> $GITHUB_OUTPUT

      - name: Build and Push Docker Image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: portfolio/${{ steps.app-info.outputs.app-name }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

      - name: Deploy Infrastructure
        uses: pulumi/actions@v5
        with:
          command: up
          stack-name: ${{ steps.app-info.outputs.app-name }}-${{ github.event.inputs.environment || 'dev' }}
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}

      - name: Force ECS Service Update
        env:
          ENVIRONMENT: ${{ github.event.inputs.environment || 'dev' }}
          APP_NAME: ${{ steps.app-info.outputs.app-name }}
        run: |
          aws ecs update-service \
            --cluster portfolio-${ENVIRONMENT}-cluster \
            --service ${APP_NAME} \
            --force-new-deployment

      - name: Output App URL
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
        run: |
          STACK="${{ steps.app-info.outputs.app-name }}-${{ github.event.inputs.environment || 'dev' }}"
          APP_URL=$(pulumi stack output appUrl --stack "$STACK")
          echo "### Deployment Complete! :rocket:" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**App URL:** $APP_URL" >> $GITHUB_STEP_SUMMARY
```

Add these secrets to your GitHub repo: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `PULUMI_ACCESS_TOKEN`.

---

## Quick Reference

| What | Value |
|------|-------|
| Platform stack reference | `Cwnelson215/portfolio-platform/dev` |
| Domain | `cwnel.com` |
| Your app URL | `https://YOUR-SUBDOMAIN.cwnel.com` |
| AWS region | `us-east-1` |
| ECS cluster name | `portfolio-dev-cluster` |
| Log location | CloudWatch `/ecs/portfolio-dev` (stream prefix = your app name) |
| Health check | `GET /health` must return HTTP 200 |
| Default container port | 3000 |
| Default CPU/memory | 256 CPU / 512 MB |

## Database Access

If your app needs PostgreSQL, the shared RDS instance is already enabled. Your container will automatically receive these environment variables:

- `DB_HOST` — Database hostname
- `DB_PORT` — `5432`
- `DB_NAME` — Derived from your app name (hyphens become underscores)
- `DB_USER` — `portfolio_admin`
- `DB_PASSWORD` — Injected from Secrets Manager

You'll need to create your app's database and run migrations yourself on first deploy.

## Monitoring

```bash
# Tail your app's logs
aws logs tail /ecs/portfolio-dev --log-stream-name-prefix YOUR-APP-NAME --follow

# Check ECS service status
aws ecs describe-services --cluster portfolio-dev-cluster --services YOUR-APP-NAME

# Check running tasks
aws ecs list-tasks --cluster portfolio-dev-cluster --service-name YOUR-APP-NAME
```

## Troubleshooting

**Service won't start:** Check CloudWatch logs. Most common causes: health check failing, port mismatch, missing environment variables.

**Health check failing:** Make sure `GET /health` returns exactly HTTP 200. The ALB checks every 30s with a 5s timeout and marks unhealthy after 3 failures.

**Image not found:** Make sure you pushed to `portfolio/YOUR-APP-NAME` in ECR (not just `YOUR-APP-NAME`). The ECR repo is created by Pulumi, so run `pulumi up` before your first image push.

**DNS not resolving:** The ALB uses host-based routing. Make sure your subdomain has a Route53 alias record pointing to the ALB. You may need to add a DNS record manually or add it to the platform stack.
