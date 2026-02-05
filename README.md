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
