# Adding a New Application

This guide walks through adding a new application to the portfolio infrastructure.

## Quick Start

```bash
# 1. Copy the example app
cp -r apps/example-app apps/my-app

# 2. Update the Pulumi project name
cd apps/my-app
sed -i 's/example-app/my-app/g' Pulumi.yaml Pulumi.dev.yaml

# 3. Initialize the stack
npm install
pulumi stack init my-app-dev

# 4. Configure the app
pulumi config set appName my-app
pulumi config set subdomain my-app  # Results in my-app.yourdomain.com

# 5. Deploy
pulumi up
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

## Creating the GitHub Actions Workflow

Create `.github/workflows/my-app.yml`:

```yaml
name: Deploy My App

on:
  push:
    branches: [main]
    paths:
      - 'apps/my-app/**'
      - '.github/workflows/my-app.yml'
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

jobs:
  deploy:
    uses: ./.github/workflows/app-deploy.yml
    with:
      app-name: my-app
      environment: ${{ github.event.inputs.environment || 'dev' }}
    secrets:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

## Customizing Your App

### Different Tech Stack

The infrastructure doesn't care what's inside your container. Replace the `src/` folder and `Dockerfile` with whatever you need:

- **Python/FastAPI**: Use a Python Dockerfile
- **Go**: Use a multi-stage Go build
- **Static site**: Use nginx to serve files
- **Next.js**: Use their recommended Dockerfile

Just ensure:
1. Your app listens on the configured `containerPort`
2. You have a `/health` endpoint that returns 200 when healthy

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
