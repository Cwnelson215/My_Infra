import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface AcmOutputs {
  certificateArn: pulumi.Output<string>;
  domainValidationOptions: pulumi.Output<aws.types.output.acm.CertificateDomainValidationOption[]>;
}

export interface AcmInputs {
  domainName: string;
  subjectAlternativeNames?: string[];
  tags: { [key: string]: string };
}

export function createAcmCertificate(name: string, inputs: AcmInputs): AcmOutputs {
  // Request ACM certificate
  // You'll need to manually add DNS validation records to Cloudflare
  const certificate = new aws.acm.Certificate(`${name}-cert`, {
    domainName: inputs.domainName,
    subjectAlternativeNames: inputs.subjectAlternativeNames,
    validationMethod: "DNS",
    tags: { ...inputs.tags, Name: `${name}-cert` },
    lifecycle: {
      createBeforeDestroy: true,
    },
  });

  return {
    certificateArn: certificate.arn,
    domainValidationOptions: certificate.domainValidationOptions,
  };
}
