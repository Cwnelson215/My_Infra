import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import { createVpc } from "./vpc";
import { createDns } from "./dns";
import { createAlb } from "./alb";
import { createEcsCluster } from "./ecs";
import { createRds } from "./rds";

// Configuration
const config = new pulumi.Config();
const environment = config.require("environment");
const domainName = config.require("domainName");
const enableSharedDatabase = config.getBoolean("enableSharedDatabase") ?? true;
const dbInstanceClass = config.get("dbInstanceClass") || "db.t4g.micro";
const dbAllocatedStorage = parseInt(config.get("dbAllocatedStorage") || "20");

// Naming and tagging
const projectName = "portfolio";
const name = `${projectName}-${environment}`;
const tags = {
  Project: projectName,
  Environment: environment,
  ManagedBy: "pulumi",
};

// =============================================================================
// Core Infrastructure
// =============================================================================

// VPC and Networking
const vpc = createVpc(name, tags);

// DNS and ACM Certificate
const dns = createDns(name, { domainName, tags });

// Application Load Balancer (with ACM certificate for HTTPS)
const alb = createAlb(name, {
  vpcId: vpc.vpcId,
  publicSubnetIds: vpc.publicSubnetIds,
  certificateArn: dns.certificateArn,
  tags,
});

// ECS Cluster
const ecs = createEcsCluster(name, tags);

// =============================================================================
// Optional: Shared Database
// =============================================================================

let rds: ReturnType<typeof createRds> | undefined;

if (enableSharedDatabase) {
  rds = createRds(name, {
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds,
    allowedSecurityGroupIds: [vpc.defaultSecurityGroupId],
    instanceClass: dbInstanceClass,
    allocatedStorage: dbAllocatedStorage,
    tags,
  });
}

// =============================================================================
// CloudWatch Log Group for all apps
// =============================================================================

const logGroup = new aws.cloudwatch.LogGroup(`${name}-logs`, {
  name: `/ecs/${name}`,
  retentionInDays: 14,
  tags,
});

// =============================================================================
// Exports - These are consumed by application stacks
// =============================================================================

// VPC
export const vpcId = vpc.vpcId;
export const publicSubnetIds = vpc.publicSubnetIds;
export const privateSubnetIds = vpc.privateSubnetIds;
export const defaultSecurityGroupId = vpc.defaultSecurityGroupId;

// ALB
export const albArn = alb.albArn;
export const albDnsName = alb.albDnsName;
export const albZoneId = alb.albZoneId;
export const httpListenerArn = alb.httpListenerArn;
export const httpsListenerArn = alb.httpsListenerArn;
export const albSecurityGroupId = alb.albSecurityGroupId;

// DNS
export const hostedZoneId = dns.hostedZoneId;
export const certificateArn = dns.certificateArn;

// ECS
export const clusterArn = ecs.clusterArn;
export const clusterName = ecs.clusterName;
export const taskExecutionRoleArn = ecs.taskExecutionRoleArn;
export const taskRoleArn = ecs.taskRoleArn;

// Database (optional)
export const dbEndpoint = rds?.dbEndpoint;
export const dbPort = rds?.dbPort;
export const dbName = rds?.dbName;
export const dbUsername = rds?.dbUsername;
export const dbPasswordSecretArn = rds?.dbPasswordSecretArn;
export const dbSecurityGroupId = rds?.dbSecurityGroupId;

// Logs
export const logGroupName = logGroup.name;

// Metadata
export { environment, domainName };
export const region = aws.getRegionOutput().name;
