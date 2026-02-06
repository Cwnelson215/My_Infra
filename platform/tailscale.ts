import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Tailscale subnet router for VPC access via Tailscale network

export interface TailscaleSubnetRouterArgs {
  vpcId: pulumi.Output<string>;
  subnetId: pulumi.Output<string>;
  advertisedRoutes: string[];
  authKeySecretName: string;
  instanceType?: string;
  tags: { [key: string]: string };
}

export interface TailscaleSubnetRouterOutputs {
  instanceId: pulumi.Output<string>;
  privateIp: pulumi.Output<string>;
  publicIp: pulumi.Output<string>;
  securityGroupId: pulumi.Output<string>;
  authKeySecretArn: pulumi.Output<string>;
}

export function createTailscaleSubnetRouter(
  name: string,
  args: TailscaleSubnetRouterArgs
): TailscaleSubnetRouterOutputs {
  const instanceType = args.instanceType || "t4g.nano";

  // Security group for Tailscale
  const sg = new aws.ec2.SecurityGroup(`${name}-tailscale-sg`, {
    vpcId: args.vpcId,
    description: "Security group for Tailscale subnet router",
    ingress: [
      // Tailscale uses UDP for WireGuard
      {
        protocol: "udp",
        fromPort: 41641,
        toPort: 41641,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Tailscale WireGuard",
      },
      // Allow SSH from within VPC for troubleshooting
      {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        cidrBlocks: ["10.0.0.0/16"],
        description: "SSH from VPC",
      },
    ],
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow all outbound",
      },
    ],
    tags: { ...args.tags, Name: `${name}-tailscale-sg` },
  });

  // IAM role for the instance
  const role = new aws.iam.Role(`${name}-tailscale-role`, {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "ec2.amazonaws.com",
          },
        },
      ],
    }),
    tags: args.tags,
  });

  // Get or create the Secrets Manager secret for the auth key
  const authKeySecret = new aws.secretsmanager.Secret(`${name}-tailscale-auth-key`, {
    name: args.authKeySecretName,
    description: "Tailscale auth key for subnet router",
    tags: args.tags,
  });

  // Policy to read the secret
  const secretPolicy = new aws.iam.RolePolicy(`${name}-tailscale-secret-policy`, {
    role: role.id,
    policy: pulumi.interpolate`{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": [
            "secretsmanager:GetSecretValue"
          ],
          "Resource": "${authKeySecret.arn}"
        }
      ]
    }`,
  });

  // Attach SSM managed policy for Session Manager access (optional but useful)
  new aws.iam.RolePolicyAttachment(`${name}-tailscale-ssm`, {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });

  // Instance profile
  const instanceProfile = new aws.iam.InstanceProfile(`${name}-tailscale-profile`, {
    role: role.name,
    tags: args.tags,
  });

  // Get the latest Amazon Linux 2023 ARM AMI
  const ami = aws.ec2.getAmi({
    mostRecent: true,
    owners: ["amazon"],
    filters: [
      {
        name: "name",
        values: ["al2023-ami-*-arm64"],
      },
      {
        name: "virtualization-type",
        values: ["hvm"],
      },
    ],
  });

  // User data script to install and configure Tailscale
  const advertisedRoutesStr = args.advertisedRoutes.join(",");
  const region = aws.getRegionOutput().name;
  const userData = pulumi.interpolate`#!/bin/bash
set -e

# Enable IP forwarding
echo 'net.ipv4.ip_forward = 1' | tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | tee -a /etc/sysctl.d/99-tailscale.conf
sysctl -p /etc/sysctl.d/99-tailscale.conf

# Install Tailscale
dnf config-manager --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo
dnf install -y tailscale

# Enable and start tailscaled
systemctl enable --now tailscaled

# Wait for tailscaled to be ready
sleep 5

# Get auth key from Secrets Manager
AUTH_KEY=$(aws secretsmanager get-secret-value --secret-id ${authKeySecret.name} --region ${region} --query SecretString --output text)

# Authenticate and advertise routes
tailscale up --authkey="$AUTH_KEY" --advertise-routes=${advertisedRoutesStr} --accept-dns=false --hostname=${name}-subnet-router
`;

  // EC2 instance
  const instance = new aws.ec2.Instance(`${name}-tailscale`, {
    ami: ami.then((a) => a.id),
    instanceType: instanceType,
    subnetId: args.subnetId,
    vpcSecurityGroupIds: [sg.id],
    iamInstanceProfile: instanceProfile.name,
    sourceDestCheck: false, // Required for routing
    userData: userData,
    userDataReplaceOnChange: true,
    rootBlockDevice: {
      volumeSize: 30,
      volumeType: "gp3",
      encrypted: true,
    },
    metadataOptions: {
      httpTokens: "required", // IMDSv2
      httpPutResponseHopLimit: 2,
    },
    tags: { ...args.tags, Name: `${name}-tailscale-router` },
  });

  return {
    instanceId: instance.id,
    privateIp: instance.privateIp,
    publicIp: instance.publicIp,
    securityGroupId: sg.id,
    authKeySecretArn: authKeySecret.arn,
  };
}
