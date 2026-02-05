# Portfolio Infrastructure

A reusable infrastructure pattern for deploying multiple web applications on AWS using Pulumi.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Platform Stack (shared resources)                          │
│  - VPC with public/private subnets                          │
│  - Application Load Balancer                                │
│  - ECR repositories                                         │
│  - Route53 hosted zone                                      │
│  - RDS PostgreSQL (optional, shared)                        │
│  - Security groups                                          │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   App Stack A   │  │   App Stack B   │  │   App Stack C   │
│                 │  │                 │  │                 │
│  - ECS Service  │  │  - ECS Service  │  │  - Lambda       │
│  - Target Group │  │  - Target Group │  │  - API Gateway  │
│  - ALB Rule     │  │  - ALB Rule     │  │                 │
│  - App DB       │  │  - App DB       │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Project Structure

```
portfolio-infra/
├── platform/              # Shared infrastructure
│   ├── Pulumi.yaml
│   ├── Pulumi.dev.yaml    # Dev environment config
│   ├── Pulumi.prod.yaml   # Prod environment config
│   ├── index.ts           # Main platform stack
│   ├── vpc.ts             # VPC and networking
│   ├── alb.ts             # Application Load Balancer
│   ├── ecr.ts             # Container registry
│   ├── rds.ts             # Shared database (optional)
│   └── dns.ts             # Route53 configuration
│
├── apps/
│   └── example-app/       # Template for new applications
│       ├── Pulumi.yaml
│       ├── Pulumi.dev.yaml
│       ├── index.ts       # App-specific infrastructure
│       ├── Dockerfile
│       └── src/           # Application code
│
└── .github/
    └── workflows/
        ├── platform.yml   # Deploy platform changes
        └── app-deploy.yml # Reusable app deployment
```

## Getting Started

### Prerequisites

- Node.js 18+
- Pulumi CLI (`curl -fsSL https://get.pulumi.com | sh`)
- AWS CLI configured with credentials
- Docker

### Initial Setup

1. **Install dependencies:**
   ```bash
   cd platform && npm install
   ```

2. **Configure Pulumi:**
   ```bash
   pulumi login  # Use Pulumi Cloud (free tier) or local backend
   ```

3. **Set your configuration:**
   ```bash
   cd platform
   pulumi config set aws:region us-east-1
   pulumi config set domainName yourdomain.com
   ```

4. **Deploy the platform:**
   ```bash
   pulumi up
   ```

### Adding a New Application

1. **Copy the example app:**
   ```bash
   cp -r apps/example-app apps/my-new-app
   ```

2. **Update the app configuration:**
   ```bash
   cd apps/my-new-app
   pulumi stack init my-new-app-dev
   pulumi config set appName my-new-app
   pulumi config set subdomain my-new-app  # becomes my-new-app.yourdomain.com
   ```

3. **Reference the platform stack:**
   The app stack automatically imports outputs from the platform stack.

4. **Deploy:**
   ```bash
   pulumi up
   ```

## Cost Optimization

This setup is designed for low-cost portfolio projects:

- **ECS Fargate Spot**: ~70% cheaper than on-demand for non-critical workloads
- **Shared ALB**: One load balancer for all apps (ALB has a base cost)
- **Shared RDS**: Single small instance with per-app databases
- **NAT Instance**: Optional alternative to NAT Gateway ($30+/month savings)

### Estimated Monthly Costs (us-east-1)

| Component | Cost |
|-----------|------|
| ALB | ~$16 + $0.008/LCU-hour |
| ECS Fargate Spot (256MB, 0.25 vCPU) | ~$3-5 per always-on service |
| RDS db.t4g.micro | ~$12 (or free tier eligible) |
| Route53 | $0.50/zone + queries |
| ECR | Storage only, minimal |

**Total for 2-3 small apps: ~$25-40/month**

## Expanding Later

This foundation supports growth:

- **Add Redis**: ElastiCache or self-hosted on ECS
- **Add message queues**: SQS is pay-per-use
- **Add search**: OpenSearch (expensive) or self-hosted Meilisearch
- **Add Lambda functions**: App stacks can mix ECS and Lambda
- **Multiple environments**: Create prod stacks alongside dev

## Environment Variables

Apps receive these from the platform:

- `DATABASE_URL` - Connection string for app's database
- `AWS_REGION` - Current region
- Custom variables defined per-app in Pulumi config

## Adding a New Application (Step-by-Step)

### Step 1: Copy the example app

```bash
cp -r apps/example-app apps/my-app
```

This gives you the full scaffold: Pulumi project files, a `Dockerfile`, infrastructure code (`index.ts`), and a sample Node.js app in `src/`.

### Step 2: Update the Pulumi project name

Edit `apps/my-app/Pulumi.yaml`:

```yaml
name: my-app
runtime: nodejs
description: My application deployed on the portfolio platform
```

### Step 3: Update the stack configuration

Edit `apps/my-app/Pulumi.dev.yaml` to set your app's name, subdomain, and any resource overrides:

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

The `platformStack` value is how your app imports shared resources (VPC, ALB, ECS cluster, DNS zone, certificates) from the platform via Pulumi's `StackReference`.

### Step 4: Replace the application code

Swap out the `src/` directory and `Dockerfile` with your actual application. The infrastructure is language-agnostic -- use Node.js, Python, Go, a static site behind nginx, or anything else that runs in a container. Your app must satisfy two contracts:

1. Listen on the configured `containerPort` (default `3000`)
2. Expose a `GET /health` endpoint that returns HTTP `200` when healthy

### Step 5: Install dependencies and initialize the stack

```bash
cd apps/my-app
npm install
pulumi stack init my-app-dev
```

### Step 6: Deploy

```bash
pulumi up
```

This creates all the app-specific AWS resources:

- **ECR repository** -- stores your Docker images (`portfolio/my-app`)
- **Security group** -- allows inbound traffic from the ALB on your container port
- **ALB target group** -- health-checked target for your ECS tasks
- **ALB listener rule** -- routes `my-app.yourdomain.com` to your target group via host-based routing
- **ECS task definition** -- container config, environment variables, log configuration, health check
- **ECS service** -- runs your container on Fargate (Spot by default), wired to the ALB

### Step 7: Create a GitHub Actions workflow

Add `.github/workflows/my-app.yml` to automate deployments on push:

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

This calls the reusable `app-deploy.yml` workflow, which handles: building and pushing the Docker image to ECR, running `pulumi up` for infrastructure, forcing an ECS service redeployment, and printing the app URL.

### Step 8: Push and iterate

Commit your new app directory and workflow file. From this point on, any push to `main` that touches `apps/my-app/**` will automatically build, push, and deploy your application.
