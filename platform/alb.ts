import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface AlbOutputs {
  albArn: pulumi.Output<string>;
  albDnsName: pulumi.Output<string>;
  albZoneId: pulumi.Output<string>;
  httpListenerArn: pulumi.Output<string>;
  httpsListenerArn: pulumi.Output<string>;
  albSecurityGroupId: pulumi.Output<string>;
}

export interface AlbInputs {
  vpcId: pulumi.Output<string>;
  publicSubnetIds: pulumi.Output<string>[];
  certificateArn?: pulumi.Output<string>;
  tags: { [key: string]: string };
}

export function createAlb(name: string, inputs: AlbInputs): AlbOutputs {
  // Security group for ALB
  const albSg = new aws.ec2.SecurityGroup(`${name}-alb-sg`, {
    vpcId: inputs.vpcId,
    description: "Security group for Application Load Balancer",
    ingress: [
      {
        protocol: "tcp",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"],
        description: "HTTP",
      },
      {
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: ["0.0.0.0/0"],
        description: "HTTPS",
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
    tags: { ...inputs.tags, Name: `${name}-alb-sg` },
  });

  // Application Load Balancer
  const alb = new aws.lb.LoadBalancer(`${name}-alb`, {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [albSg.id],
    subnets: inputs.publicSubnetIds,
    enableDeletionProtection: false, // Set to true for prod
    tags: { ...inputs.tags, Name: `${name}-alb` },
  });

  // HTTP Listener - returns 404 by default (open for ALB health checks)
  const httpListener = new aws.lb.Listener(`${name}-http-listener`, {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      {
        type: "fixed-response",
        fixedResponse: {
          contentType: "text/plain",
          messageBody: "Not Found",
          statusCode: "404",
        },
      },
    ],
    tags: inputs.tags,
  });

  // HTTPS Listener - returns 404 by default, apps add their own listener rules
  let httpsListener: aws.lb.Listener | undefined;
  if (inputs.certificateArn) {
    httpsListener = new aws.lb.Listener(`${name}-https-listener`, {
      loadBalancerArn: alb.arn,
      port: 443,
      protocol: "HTTPS",
      sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      certificateArn: inputs.certificateArn,
      defaultActions: [
        {
          type: "fixed-response",
          fixedResponse: {
            contentType: "text/plain",
            messageBody: "Not Found",
            statusCode: "404",
          },
        },
      ],
      tags: inputs.tags,
    });
  }

  return {
    albArn: alb.arn,
    albDnsName: alb.dnsName,
    albZoneId: alb.zoneId,
    httpListenerArn: httpListener.arn,
    httpsListenerArn: httpsListener?.arn || httpListener.arn,
    albSecurityGroupId: albSg.id,
  };
}
