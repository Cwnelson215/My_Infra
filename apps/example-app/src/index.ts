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
const cloudflareTunnelToken = config.requireSecret("cloudflareTunnelToken");

// =============================================================================
// Import Platform Stack Outputs
// =============================================================================

const platformStack = new pulumi.StackReference(platformStackName);

const vpcId = platformStack.getOutput("vpcId") as pulumi.Output<string>;
const publicSubnetIds = platformStack.getOutput("publicSubnetIds") as pulumi.Output<string[]>;
const defaultSecurityGroupId = platformStack.getOutput("defaultSecurityGroupId") as pulumi.Output<string>;

const clusterArn = platformStack.getOutput("clusterArn") as pulumi.Output<string>;
const taskExecutionRoleArn = platformStack.getOutput("taskExecutionRoleArn") as pulumi.Output<string>;
const taskRoleArn = platformStack.getOutput("taskRoleArn") as pulumi.Output<string>;

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
// Security Group for the app (egress only - no inbound needed with tunnel)
// =============================================================================

const appSg = new aws.ec2.SecurityGroup(`${appName}-sg`, {
  vpcId,
  description: `Security group for ${appName}`,
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
// ECS Task Definition
// =============================================================================

// Build environment variables
const containerEnv = [
  { name: "NODE_ENV", value: "production" },
  { name: "PORT", value: containerPort.toString() },
];

// Task definition with app + cloudflared sidecar
const taskDefinition = new aws.ecs.TaskDefinition(`${appName}-task`, {
  family: appName,
  cpu: cpu.toString(),
  memory: memory.toString(),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: taskExecutionRoleArn,
  taskRoleArn: taskRoleArn,
  containerDefinitions: pulumi
    .all([ecrRepo.repositoryUrl, logGroupName, region, dbEndpoint, dbPasswordSecretArn, cloudflareTunnelToken])
    .apply(([repoUrl, logGroup, awsRegion, dbHost, dbSecretArn, tunnelToken]) => {
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
        {
          name: "cloudflared",
          image: "cloudflare/cloudflared:latest",
          essential: true,
          command: ["tunnel", "--no-autoupdate", "run", "--token", tunnelToken],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroup,
              "awslogs-region": awsRegion,
              "awslogs-stream-prefix": "cloudflared",
            },
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
  deploymentMinimumHealthyPercent: 50,
  deploymentMaximumPercent: 200,
  propagateTags: "SERVICE",
  tags,
});

// =============================================================================
// Outputs
// =============================================================================

export const appUrl = `https://${subdomain}.cwnel.com`;
export const ecrRepositoryUrl = ecrRepo.repositoryUrl;
export const serviceName = service.name;
export const serviceArn = service.id;
