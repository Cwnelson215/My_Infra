import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface DnsOutputs {
  hostedZoneId: pulumi.Output<string>;
  certificateArn: pulumi.Output<string>;
  domainName: string;
}

export interface DnsInputs {
  domainName: string;
  tags: { [key: string]: string };
}

export function createDns(name: string, inputs: DnsInputs): DnsOutputs {
  // Use existing hosted zone - looked up by domain name
  const hostedZone = aws.route53.getZoneOutput({
    name: inputs.domainName,
  });

  // Use existing wildcard certificate
  const certificate = aws.acm.getCertificateOutput({
    domain: inputs.domainName,
    statuses: ["ISSUED"],
    mostRecent: true,
  });

  return {
    hostedZoneId: hostedZone.id,
    certificateArn: certificate.arn,
    domainName: inputs.domainName,
  };
}

// Helper to create subdomain records pointing to ALB
export function createAlbDnsRecord(
  name: string,
  subdomain: string,
  hostedZoneId: pulumi.Output<string>,
  domainName: string,
  albDnsName: pulumi.Output<string>,
  albZoneId: pulumi.Output<string>
): aws.route53.Record {
  return new aws.route53.Record(`${name}-${subdomain}-record`, {
    zoneId: hostedZoneId,
    name: `${subdomain}.${domainName}`,
    type: "A",
    aliases: [
      {
        name: albDnsName,
        zoneId: albZoneId,
        evaluateTargetHealth: true,
      },
    ],
  });
}