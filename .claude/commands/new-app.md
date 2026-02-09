# Scaffold a New Portfolio App

You are scaffolding a new application that will deploy onto the shared portfolio platform infrastructure. Follow these instructions precisely.

## Step 1: Gather Information

Ask the user the following questions interactively using the AskUserQuestion tool. Ask all questions in a single call:

1. **App name** — kebab-case (e.g., `my-cool-app`). Used for resource naming, ECR repo, subdomain default.
2. **Subdomain** — defaults to app name. Becomes `{subdomain}.cwnel.com`.
3. **App type** — one of:
   - **Node.js server** (Express/Fastify/etc. — uses multi-stage Node.js Dockerfile)
   - **Static site** (React/Vite SPA — uses nginx Dockerfile + nginx.conf)
   - **Custom** (empty Dockerfile the user will fill in)
4. **Needs shared PostgreSQL database?** — yes/no (default no). If yes, DB env vars are injected automatically.
5. **Container port** — default `3000`.
6. **CPU / Memory** — default `256` CPU / `512` MB.
7. **Enable scheduled scaling?** — yes/no (default no). If yes, ask scale-up hour and scale-down hour (defaults: 6 AM up, 10 PM down, America/Denver).
8. **Use Fargate Spot?** — default yes.

Store all answers as variables for template substitution.

## Step 2: Create the App Directory

Create the app at `~/Dev/portfolio/{app-name}/` with this structure:

```
{app-name}/
├── index.ts
├── Pulumi.yaml
├── Pulumi.dev.yaml
├── package.json
├── tsconfig.json
├── Dockerfile
├── CLAUDE.md
├── src/
│   └── index.ts          (Node.js apps only)
├── nginx.conf             (static site apps only)
└── .github/
    └── workflows/
        └── deploy.yml
```

## Step 3: Write All Files

Use the templates below with the user's answers substituted in. Replace all `{placeholders}` with actual values.

---

### `Pulumi.yaml`

```yaml
name: {app-name}
runtime: nodejs
description: {app-name} deployed on the portfolio platform
```

### `Pulumi.dev.yaml`

```yaml
config:
  aws:region: us-east-1
  {app-name}:appName: {app-name}
  {app-name}:subdomain: {subdomain}
  {app-name}:platformStack: cwnelson/portfolio-platform/dev
  {app-name}:cpu: "{cpu}"
  {app-name}:memory: "{memory}"
  {app-name}:desiredCount: "1"
  {app-name}:containerPort: "{container-port}"
  {app-name}:useFargateSpot: "{use-fargate-spot}"
```

If scheduled scaling is enabled, also add:

```yaml
  {app-name}:enableScheduledScaling: "true"
  {app-name}:scaleUpHour: "{scale-up-hour}"
  {app-name}:scaleDownHour: "{scale-down-hour}"
  {app-name}:scheduleTimezone: "America/Denver"
```

### `package.json`

```json
{
  "name": "{app-name}-infra",
  "version": "1.0.0",
  "description": "Infrastructure for {app-name}",
  "main": "index.ts",
  "scripts": {
    "build": "tsc",
    "preview": "pulumi preview",
    "up": "pulumi up",
    "destroy": "pulumi destroy"
  },
  "dependencies": {
    "@pulumi/aws": "^6.0.0",
    "@pulumi/pulumi": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

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

### `index.ts` (Pulumi infrastructure)

This is the full app infrastructure. Include the database section ONLY if the user said they need the database. Include the scheduled scaling section ONLY if the user enabled it.

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
const scaleUpHour = parseInt(config.get("scaleUpHour") || "6");    // 6 AM
const scaleDownHour = parseInt(config.get("scaleDownHour") || "22"); // 10 PM
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
// ECR Repository for this app
// =============================================================================

const ecrRepo = new aws.ecr.Repository(`${appName}-repo`, {
  name: `portfolio/${appName}`,
  imageTagMutability: "MUTABLE",
  imageScanningConfiguration: {
    scanOnPush: true,
  },
  tags,
});

new aws.ecr.LifecyclePolicy(`${appName}-lifecycle`, {
  repository: ecrRepo.name,
  policy: JSON.stringify({
    rules: [
      {
        rulePriority: 1,
        description: "Keep last 10 images",
        selection: {
          tagStatus: "any",
          countType: "imageCountMoreThan",
          countNumber: 10,
        },
        action: {
          type: "expire",
        },
      },
    ],
  }),
});

// =============================================================================
// Security Group for the app
// =============================================================================

const appSg = new aws.ec2.SecurityGroup(`${appName}-sg`, {
  vpcId,
  description: `Security group for ${appName}`,
  ingress: [
    {
      protocol: "tcp",
      fromPort: containerPort,
      toPort: containerPort,
      securityGroups: [albSecurityGroupId],
      description: "Allow traffic from ALB",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: { ...tags, Name: `${appName}-sg` },
});

// =============================================================================
// Target Group
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

// =============================================================================
// ALB Listener Rule (host-based routing on HTTPS)
// =============================================================================

const fullHostname = pulumi.interpolate`${subdomain}.${domainName}`;

const listenerRule = new aws.lb.ListenerRule(`${appName}-rule`, {
  listenerArn: httpsListenerArn,
  priority: pulumi.output(subdomain).apply((s) => {
    // Generate a consistent priority from subdomain name
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash % 49000) + 1000; // Range 1000-50000
  }),
  conditions: [
    {
      hostHeader: {
        values: [fullHostname],
      },
    },
  ],
  actions: [
    {
      type: "forward",
      targetGroupArn: targetGroup.arn,
    },
  ],
  tags,
});

// =============================================================================
// ECS Task Definition
// =============================================================================

// Build environment variables
const containerEnv = [
  { name: "NODE_ENV", value: "production" },
  { name: "PORT", value: containerPort.toString() },
];

// Task definition
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

      // Add database config if available
      if (dbHost) {
        env.push({ name: "DB_HOST", value: dbHost.split(":")[0] });
        env.push({ name: "DB_PORT", value: "5432" });
        env.push({ name: "DB_NAME", value: appName.replace(/-/g, "_") });
        env.push({ name: "DB_USER", value: "portfolio_admin" });
      }
      if (dbSecretArn) {
        secrets.push({ name: "DB_PASSWORD", valueFrom: dbSecretArn });
      }

      return JSON.stringify([
        {
          name: appName,
          image: `${repoUrl}:latest`,
          essential: true,
          portMappings: [
            {
              containerPort: containerPort,
              protocol: "tcp",
            },
          ],
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
        },
      ]);
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
  desiredCount: desiredCount,
  launchType: useFargateSpot ? undefined : "FARGATE",
  capacityProviderStrategies: useFargateSpot
    ? [
        {
          capacityProvider: "FARGATE_SPOT",
          weight: 1,
          base: 0,
        },
        {
          capacityProvider: "FARGATE",
          weight: 0,
          base: 1,
        },
      ]
    : undefined,
  networkConfiguration: {
    subnets: publicSubnetIds,
    securityGroups: [appSg.id, defaultSecurityGroupId],
    assignPublicIp: true,
  },
  loadBalancers: [
    {
      targetGroupArn: targetGroup.arn,
      containerName: appName,
      containerPort: containerPort,
    },
  ],
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
  // Auto Scaling target
  const scalingTarget = new aws.appautoscaling.Target(`${appName}-scaling-target`, {
    maxCapacity: desiredCount,
    minCapacity: 0,
    resourceId: pulumi.interpolate`service/${clusterArn.apply(arn => arn.split('/').pop())}/${service.name}`,
    scalableDimension: "ecs:service:DesiredCount",
    serviceNamespace: "ecs",
  });

  // Scale up in the morning
  new aws.appautoscaling.ScheduledAction(`${appName}-scale-up`, {
    name: `${appName}-scale-up`,
    serviceNamespace: scalingTarget.serviceNamespace,
    resourceId: scalingTarget.resourceId,
    scalableDimension: scalingTarget.scalableDimension,
    schedule: `cron(0 ${scaleUpHour} * * ? *)`,
    timezone: scheduleTimezone,
    scalableTargetAction: {
      minCapacity: desiredCount,
      maxCapacity: desiredCount,
    },
  });

  // Scale down at night
  new aws.appautoscaling.ScheduledAction(`${appName}-scale-down`, {
    name: `${appName}-scale-down`,
    serviceNamespace: scalingTarget.serviceNamespace,
    resourceId: scalingTarget.resourceId,
    scalableDimension: scalingTarget.scalableDimension,
    schedule: `cron(0 ${scaleDownHour} * * ? *)`,
    timezone: scheduleTimezone,
    scalableTargetAction: {
      minCapacity: 0,
      maxCapacity: 0,
    },
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

### `Dockerfile` — Node.js Server

Use this when the user chose "Node.js server":

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

# Create non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER appuser

EXPOSE {container-port}

CMD ["node", "dist/index.js"]
```

### `Dockerfile` — Static Site (nginx)

Use this when the user chose "Static site":

```dockerfile
# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE {container-port}

CMD ["nginx", "-g", "daemon off;"]
```

### `nginx.conf` (static site only)

Only create this file if the user chose "Static site":

```nginx
server {
    listen {container-port};

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

### `src/index.ts` — Starter Health Endpoint (Node.js server only)

Only create this file if the user chose "Node.js server". This gives them a working app out of the box:

```typescript
import http from "http";

const port = parseInt(process.env.PORT || "{container-port}");

const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello from {app-name}!");
});

server.listen(port, () => {
  console.log(`{app-name} listening on port ${port}`);
});
```

For Node.js apps, the app-level `package.json` for `src/` is separate from the infra `package.json`. Create an additional `src/package.json`:

```json
{
  "name": "{app-name}",
  "version": "1.0.0",
  "description": "{app-name}",
  "main": "dist/index.js",
  "scripts": {
    "dev": "npx tsx watch src/index.ts",
    "build": "tsc -p tsconfig.app.json",
    "start": "node dist/index.js"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

And a `tsconfig.app.json` in the project root for building the app (separate from infra tsconfig):

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
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `CLAUDE.md`

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A containerized web application deployed on the portfolio platform. Infrastructure is defined with Pulumi (TypeScript) and references shared AWS resources (VPC, ALB, ECS cluster, RDS) from the platform stack via `pulumi.StackReference`.

## Commands

```bash
# Application
npm install           # Install dependencies
npm run dev           # Run locally (http://localhost:{container-port})
npm run build         # Build for production
npm start             # Start production server

# Infrastructure (Pulumi)
npm run preview       # Preview infra changes
npm run up            # Deploy infra
npm run destroy       # Tear down infra
```

## Architecture

**App contract:** The container must (1) listen on the configured port (default {container-port}) and (2) expose `GET /health` returning HTTP 200.

**Infrastructure (`index.ts`):** Defines app-specific AWS resources:
- ECR repository (`portfolio/{app-name}`) with lifecycle policy (keep last 10 images)
- Security group allowing traffic from the shared ALB
- ALB target group + host-based listener rule (`{subdomain}.cwnel.com`)
- ECS Fargate task definition + service (Fargate Spot by default)
- Optional scheduled scaling (scale to zero at night)

All shared resources (VPC, ALB, ECS cluster, Route53, ACM, CloudWatch log group, RDS) come from the platform stack and are imported via `pulumi.StackReference`.

## Key Files

- `src/` — Application source code
- `index.ts` — Pulumi infrastructure definition
- `Pulumi.yaml` — Project metadata
- `Pulumi.dev.yaml` — Environment config (appName, subdomain, platformStack, cpu, memory, etc.)
- `Dockerfile` — Container build definition
- `.github/workflows/deploy.yml` — CI/CD pipeline

## Conventions

- **Naming:** Resources prefixed with `appName`. All tagged with Project, App, ManagedBy.
- **Config:** Environment-specific values in `Pulumi.{stack}.yaml`. Secrets via `pulumi config set --secret`.
- **Logs:** CloudWatch at `/ecs/portfolio-dev/{app-name}`, 14-day retention.
- **Platform stack reference:** `cwnelson/portfolio-platform/dev`
- **Health check:** `GET /health` must return HTTP 200 — this is used by both the ALB target group and the ECS container health check.
```

### `.github/workflows/deploy.yml`

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

## Step 4: Run npm install

After writing all files, run `npm install` inside the app directory to install the Pulumi infrastructure dependencies.

## Step 5: Print Summary

After everything is created, print a summary like this:

```
App scaffolded at ~/Dev/portfolio/{app-name}/

Files created:
  index.ts              — Pulumi infrastructure (ECR, SG, ALB rule, ECS task/service)
  Pulumi.yaml           — Project metadata
  Pulumi.dev.yaml       — Stack config (appName, subdomain, platformStack, etc.)
  package.json          — Infra dependencies (@pulumi/aws, @pulumi/pulumi)
  tsconfig.json         — TypeScript config for Pulumi
  Dockerfile            — {Node.js multi-stage | nginx static site | empty custom}
  CLAUDE.md             — Claude Code instructions for this app
  .github/workflows/deploy.yml — CI/CD pipeline
  {src/index.ts}        — (if Node.js) Starter server with /health endpoint
  {nginx.conf}          — (if static site) nginx config with /health and SPA routing

URL: https://{subdomain}.cwnel.com

Next steps:
  1. cd ~/Dev/portfolio/{app-name}
  2. git init && git add -A && git commit -m "Initial scaffold"
  3. Write your application code in src/
  4. pulumi stack init {app-name}-dev
  5. pulumi up  (deploys infrastructure)
  6. Build and push your Docker image to ECR
  7. Create GitHub repo and add secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, PULUMI_ACCESS_TOKEN
```

## Platform Reference (DO NOT ask the user for these — they are fixed)

- **Stack reference:** `cwnelson/portfolio-platform/dev`
- **Domain:** `cwnel.com`
- **ECR naming:** `portfolio/{app-name}`
- **Log group:** `/ecs/portfolio-dev/{app-name}` (stream prefix = app name)
- **Log retention:** 14 days
- **VPC CIDR:** `10.0.0.0/16`, 2 public + 2 private subnets, no NAT Gateway
- **ALB:** Internet-facing, HTTP->HTTPS redirect, TLS 1.2+, host-based routing
- **ECS:** Fargate + Fargate Spot capacity providers, shared execution/task roles
- **RDS:** PostgreSQL 15, `db.t4g.micro`, user `portfolio_admin`, password in Secrets Manager
- **App contract:** Container must listen on `containerPort` and expose `GET /health` returning HTTP 200
- **Required GitHub secrets:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `PULUMI_ACCESS_TOKEN`

### Available platform stack outputs

```
vpcId, publicSubnetIds, privateSubnetIds, defaultSecurityGroupId
albArn, albDnsName, albZoneId, httpListenerArn, httpsListenerArn, albSecurityGroupId
hostedZoneId, certificateArn
clusterArn, clusterName, taskExecutionRoleArn, taskRoleArn
dbEndpoint, dbPort, dbName, dbUsername, dbPasswordSecretArn, dbSecurityGroupId
logGroupName
tailscaleInstanceId, tailscalePrivateIp, tailscalePublicIp, tailscaleSecurityGroupId, tailscaleAuthKeySecretArn
environment, domainName, region
```
