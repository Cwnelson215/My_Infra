# Renovate + CI/CD Setup for Portfolio Apps

## Overview

- **Shared preset** (`renovate-config` repo): Central Renovate rules all apps inherit
- **Per-app config** (`renovate.json`): Dropped into each app repo, extends the preset
- **GitHub Actions** (`deploy.yml`): Validates PRs and deploys on merge to main

## Setup Steps

### 1. Create the shared preset repo

Create a new GitHub repo called `renovate-config` and add `default.json` to the root.

### 2. Install Renovate on GitHub

Go to https://github.com/apps/renovate and install it on your repos (or your whole account).

### 3. Per app repo

Copy into each app repo:
- `renovate.json` → repo root (update the GitHub username)
- `.github/workflows/deploy.yml` → as-is (update `APP_NAME` env var)

### 4. AWS credentials for GitHub Actions

Set up OIDC federation or store credentials as repo secrets:
- `AWS_ROLE_ARN`: IAM role with ECR push + ECS update-service permissions

### Customizing per app

If an app needs different rules (e.g., no automerge), override in its `renovate.json`:

```json
{
  "extends": ["github>YOUR_GITHUB_USERNAME/renovate-config"],
  "packageRules": [
    {
      "matchPackageNames": ["socket.io"],
      "automerge": false
    }
  ]
}
```

### What happens

1. Renovate opens PRs for outdated deps (grouped, labeled)
2. GitHub Actions runs `validate` on the PR (build check)
3. Patch/minor updates automerge if CI passes
4. Major updates and Docker image updates require manual review
5. On merge to main, the deploy job builds, pushes to ECR, and redeploys ECS
