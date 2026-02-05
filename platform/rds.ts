import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";

export interface RdsOutputs {
  dbEndpoint: pulumi.Output<string>;
  dbPort: pulumi.Output<number>;
  dbName: pulumi.Output<string>;
  dbUsername: pulumi.Output<string>;
  dbPasswordSecretArn: pulumi.Output<string>;
  dbSecurityGroupId: pulumi.Output<string>;
}

export interface RdsInputs {
  vpcId: pulumi.Output<string>;
  subnetIds: pulumi.Output<string>[];
  allowedSecurityGroupIds: pulumi.Output<string>[];
  instanceClass: string;
  allocatedStorage: number;
  tags: { [key: string]: string };
}

export function createRds(name: string, inputs: RdsInputs): RdsOutputs {
  // Subnet group
  const subnetGroup = new aws.rds.SubnetGroup(`${name}-subnet-group`, {
    subnetIds: inputs.subnetIds,
    tags: { ...inputs.tags, Name: `${name}-subnet-group` },
  });

  // Security group for RDS
  const dbSg = new aws.ec2.SecurityGroup(`${name}-db-sg`, {
    vpcId: inputs.vpcId,
    description: "Security group for RDS PostgreSQL",
    ingress: inputs.allowedSecurityGroupIds.map((sgId) => ({
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      securityGroups: [sgId],
    })),
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    tags: { ...inputs.tags, Name: `${name}-db-sg` },
  });

  // Generate random password
  const dbPassword = new random.RandomPassword(`${name}-db-password`, {
    length: 32,
    special: true,
    overrideSpecial: "!#$%&*()-_=+[]{}<>:?",
  });

  // Store password in Secrets Manager
  const dbSecret = new aws.secretsmanager.Secret(`${name}-db-secret`, {
    name: `${name}/db-password`,
    tags: inputs.tags,
  });

  new aws.secretsmanager.SecretVersion(`${name}-db-secret-version`, {
    secretId: dbSecret.id,
    secretString: dbPassword.result,
  });

  // RDS Instance
  const db = new aws.rds.Instance(`${name}-postgres`, {
    identifier: `${name}-postgres`,
    engine: "postgres",
    engineVersion: "15",
    instanceClass: inputs.instanceClass,
    allocatedStorage: inputs.allocatedStorage,
    dbName: "portfolio",
    username: "portfolio_admin",
    password: dbPassword.result,
    dbSubnetGroupName: subnetGroup.name,
    vpcSecurityGroupIds: [dbSg.id],
    publiclyAccessible: false,
    skipFinalSnapshot: true, // Set to false for prod
    deletionProtection: false, // Set to true for prod
    backupRetentionPeriod: 7,
    backupWindow: "03:00-04:00",
    maintenanceWindow: "Mon:04:00-Mon:05:00",
    storageEncrypted: true,
    performanceInsightsEnabled: false, // Enable for prod if needed
    tags: { ...inputs.tags, Name: `${name}-postgres` },
  });

  return {
    dbEndpoint: db.endpoint,
    dbPort: pulumi.output(5432),
    dbName: db.dbName.apply((n) => n || "portfolio"),
    dbUsername: db.username.apply((u) => u || "portfolio_admin"),
    dbPasswordSecretArn: dbSecret.arn,
    dbSecurityGroupId: dbSg.id,
  };
}
