import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface EcsOutputs {
  clusterArn: pulumi.Output<string>;
  clusterName: pulumi.Output<string>;
  taskExecutionRoleArn: pulumi.Output<string>;
  taskRoleArn: pulumi.Output<string>;
}

export function createEcsCluster(
  name: string,
  tags: { [key: string]: string }
): EcsOutputs {
  // ECS Cluster
  const cluster = new aws.ecs.Cluster(`${name}-cluster`, {
    name: `${name}-cluster`,
    settings: [
      {
        name: "containerInsights",
        value: "disabled", // Enable for prod if needed (adds cost)
      },
    ],
    tags,
  });

  // Cluster capacity providers (Fargate and Fargate Spot)
  new aws.ecs.ClusterCapacityProviders(`${name}-capacity-providers`, {
    clusterName: cluster.name,
    capacityProviders: ["FARGATE", "FARGATE_SPOT"],
    defaultCapacityProviderStrategies: [
      {
        capacityProvider: "FARGATE_SPOT",
        weight: 1,
        base: 0,
      },
      {
        capacityProvider: "FARGATE",
        weight: 0,
        base: 1, // At least 1 task on regular Fargate for reliability
      },
    ],
  });

  // Task execution role (for ECS to pull images, write logs)
  const taskExecutionRole = new aws.iam.Role(`${name}-task-execution-role`, {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
          Effect: "Allow",
        },
      ],
    }),
    tags,
  });

  new aws.iam.RolePolicyAttachment(`${name}-task-execution-policy`, {
    role: taskExecutionRole.name,
    policyArn:
      "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  });

  // Allow reading secrets
  new aws.iam.RolePolicy(`${name}-task-execution-secrets`, {
    role: taskExecutionRole.name,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["secretsmanager:GetSecretValue"],
          Resource: "*", // Scope down in prod
        },
      ],
    }),
  });

  // Task role (for application to access AWS services)
  const taskRole = new aws.iam.Role(`${name}-task-role`, {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
          Effect: "Allow",
        },
      ],
    }),
    tags,
  });

  // Basic permissions for task role - add more as needed per app
  new aws.iam.RolePolicy(`${name}-task-policy`, {
    role: taskRole.name,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          Resource: "*",
        },
      ],
    }),
  });

  return {
    clusterArn: cluster.arn,
    clusterName: cluster.name,
    taskExecutionRoleArn: taskExecutionRole.arn,
    taskRoleArn: taskRole.arn,
  };
}
