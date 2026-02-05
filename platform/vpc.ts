import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface VpcOutputs {
  vpcId: pulumi.Output<string>;
  publicSubnetIds: pulumi.Output<string>[];
  privateSubnetIds: pulumi.Output<string>[];
  defaultSecurityGroupId: pulumi.Output<string>;
}

export function createVpc(name: string, tags: { [key: string]: string }): VpcOutputs {
  // Create VPC
  const vpc = new aws.ec2.Vpc(`${name}-vpc`, {
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: { ...tags, Name: `${name}-vpc` },
  });

  // Internet Gateway
  const igw = new aws.ec2.InternetGateway(`${name}-igw`, {
    vpcId: vpc.id,
    tags: { ...tags, Name: `${name}-igw` },
  });

  // Get availability zones
  const azs = aws.getAvailabilityZones({ state: "available" });

  // Public subnets (2 AZs for ALB requirement)
  const publicSubnets: aws.ec2.Subnet[] = [];
  const privateSubnets: aws.ec2.Subnet[] = [];

  for (let i = 0; i < 2; i++) {
    const publicSubnet = new aws.ec2.Subnet(`${name}-public-${i}`, {
      vpcId: vpc.id,
      cidrBlock: `10.0.${i}.0/24`,
      availabilityZone: azs.then(az => az.names[i]),
      mapPublicIpOnLaunch: true,
      tags: { ...tags, Name: `${name}-public-${i}` },
    });
    publicSubnets.push(publicSubnet);

    const privateSubnet = new aws.ec2.Subnet(`${name}-private-${i}`, {
      vpcId: vpc.id,
      cidrBlock: `10.0.${i + 10}.0/24`,
      availabilityZone: azs.then(az => az.names[i]),
      tags: { ...tags, Name: `${name}-private-${i}` },
    });
    privateSubnets.push(privateSubnet);
  }

  // Public route table
  const publicRouteTable = new aws.ec2.RouteTable(`${name}-public-rt`, {
    vpcId: vpc.id,
    routes: [
      {
        cidrBlock: "0.0.0.0/0",
        gatewayId: igw.id,
      },
    ],
    tags: { ...tags, Name: `${name}-public-rt` },
  });

  // Associate public subnets with public route table
  publicSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(`${name}-public-rta-${i}`, {
      subnetId: subnet.id,
      routeTableId: publicRouteTable.id,
    });
  });

  // For cost savings, we skip NAT Gateway in dev
  // Private subnets can still pull images via VPC endpoints or NAT instance
  // Add NAT Gateway for prod if needed

  // Default security group for internal communication
  const defaultSg = new aws.ec2.SecurityGroup(`${name}-default-sg`, {
    vpcId: vpc.id,
    description: "Default security group for internal communication",
    ingress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        self: true,
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
    tags: { ...tags, Name: `${name}-default-sg` },
  });

  return {
    vpcId: vpc.id,
    publicSubnetIds: publicSubnets.map(s => s.id),
    privateSubnetIds: privateSubnets.map(s => s.id),
    defaultSecurityGroupId: defaultSg.id,
  };
}
