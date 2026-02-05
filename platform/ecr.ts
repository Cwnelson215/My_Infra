import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface EcrOutputs {
  repositoryUrl: pulumi.Output<string>;
  repositoryArn: pulumi.Output<string>;
  repositoryName: pulumi.Output<string>;
}

export function createEcrRepository(
  name: string,
  tags: { [key: string]: string }
): EcrOutputs {
  const repo = new aws.ecr.Repository(`${name}-repo`, {
    name: name,
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: {
      scanOnPush: true,
    },
    tags,
  });

  // Lifecycle policy to keep costs down
  new aws.ecr.LifecyclePolicy(`${name}-lifecycle`, {
    repository: repo.name,
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

  return {
    repositoryUrl: repo.repositoryUrl,
    repositoryArn: repo.arn,
    repositoryName: repo.name,
  };
}

// Helper to create repos for multiple apps
export function createAppRepository(
  platformName: string,
  appName: string,
  tags: { [key: string]: string }
): EcrOutputs {
  return createEcrRepository(`${platformName}/${appName}`, tags);
}
