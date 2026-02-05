# Adding a New Application

Each application lives in its own git repository and deploys independently. The app's Pulumi stack references the shared platform stack via `StackReference`, so cross-repo deployment works seamlessly.

## Quick Start

```bash
# 1. Create a new repo for your app
mkdir my-app && cd my-app
git init

# 2. Scaffold the Pulumi project (see templates below)
# 3. Add your application code in src/ and a Dockerfile
# 4. Install dependencies and initialize the stack
npm install
pulumi stack init my-app-dev

# 5. Deploy
pulumi up
```

## App Repo Structure

```
my-app/
├── index.ts              # Pulumi infra (see template below)
├── Pulumi.yaml           # Pulumi project metadata
├── Pulumi.dev.yaml       # Stack config (references platform stack)
├── package.json
├── tsconfig.json
├── Dockerfile
├── src/                  # Your application source code
└── .github/
    └── workflows/
        └── deploy.yml    # Self-contained deploy workflow
```

## Configuration Options

| Config Key | Description | Default |
|------------|-------------|---------|
| `appName` | Application name (used for resources) | Required |
| `subdomain` | Subdomain for the app | Required |
| `platformStack` | Reference to platform stack | Required |
| `cpu` | Fargate CPU units (256, 512, 1024, etc.) | 256 |
| `memory` | Fargate memory in MB | 512 |
| `desiredCount` | Number of tasks to run | 1 |
| `containerPort` | Port your app listens on | 3000 |
| `useFargateSpot` | Use Spot instances for cost savings | true |

## App Contract

Your container must satisfy two requirements:

1. Listen on the configured `containerPort` (default `3000`)
2. Expose a `GET /health` endpoint that returns HTTP `200` when healthy

The infrastructure is language-agnostic -- use Node.js, Python, Go, a static site behind nginx, or anything else that runs in a container.

## Template: `Pulumi.yaml`

```yaml
name: my-app
runtime: nodejs
description: My application deployed on the portfolio platform
```

## Template: `Pulumi.dev.yaml`

```yaml
config:
  aws:region: us-east-1
  my-app:appName: my-app
  my-app:subdomain: my-app                                    # becomes my-app.yourdomain.com
  my-app:platformStack: organization/portfolio-platform/dev    # reference to the shared platform stack
  my-app:cpu: "256"
  my-app:memory: "512"
  my-app:desiredCount: "1"
  my-app:containerPort: "3000"
  my-app:useFargateSpot: "true"
```

The `platformStack` value is how your app imports shared resources (VPC, ALB, ECS cluster, DNS zone, certificates) from the platform via Pulumi's `StackReference`. Update the organization and environment to match your setup.

## Template: `package.json`

```json
{
  "name": "my-app-infra",
  "version": "1.0.0",
  "description": "Infrastructure for my-app",
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

## Template: `tsconfig.json`

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

## Template: `index.ts`

This is the full Pulumi infrastructure code for an app. Copy it as-is and customize as needed.

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

## Template: GitHub Actions Deploy Workflow

Create `.github/workflows/deploy.yml` in your app repo. This is a self-contained workflow -- no cross-repo reusable workflow references needed.

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

Required repository secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `PULUMI_ACCESS_TOKEN`.

## Customizing Your App

### Custom Environment Variables

Add environment variables in the task definition. Edit `index.ts`:

```typescript
const containerEnv = [
  { name: "NODE_ENV", value: "production" },
  { name: "PORT", value: containerPort.toString() },
  { name: "MY_CUSTOM_VAR", value: "my-value" },
];
```

For secrets, use AWS Secrets Manager:

```typescript
const mySecret = new aws.secretsmanager.Secret(`${appName}-my-secret`, {
  name: `${appName}/my-secret`,
});

// Then reference in containerSecrets
secrets.push({ name: "MY_SECRET", valueFrom: mySecret.arn });
```

### Lambda Instead of ECS

For lightweight APIs or scheduled tasks, you might prefer Lambda. The pattern is similar but lighter:

```typescript
const lambda = new aws.lambda.Function(`${appName}-fn`, {
  runtime: "nodejs20.x",
  handler: "index.handler",
  role: lambdaRole.arn,
  code: new pulumi.asset.AssetArchive({
    ".": new pulumi.asset.FileArchive("./dist"),
  }),
  environment: {
    variables: {
      NODE_ENV: "production",
    },
  },
});

// API Gateway integration
const api = new aws.apigatewayv2.Api(`${appName}-api`, {
  protocolType: "HTTP",
});
```

## Database Access

If the platform has a shared database enabled, your app automatically gets:

- `DB_HOST` - Database hostname
- `DB_PORT` - Database port (5432)
- `DB_NAME` - Database name (derived from appName)
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password (from Secrets Manager)

Create your app's database schema on first deploy or use migrations.

## Monitoring

Logs go to CloudWatch at `/ecs/portfolio-{env}/{app-name}`. View them:

```bash
aws logs tail /ecs/portfolio-dev/my-app --follow
```

## Cost Optimization Tips

1. **Use Fargate Spot** - Set `useFargateSpot: true` (default)
2. **Right-size containers** - Start with 256 CPU / 512 MB, increase if needed
3. **Scale to zero** - Set `desiredCount: 0` when not in use
4. **Share the database** - Use the platform's shared RDS instead of per-app databases
