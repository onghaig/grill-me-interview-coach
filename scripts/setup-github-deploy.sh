#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy to Cloud Run without any stored password or key file.
#
# GitHub proves its identity to Google with a short-lived token (Workload Identity Federation). The Google
# side only trusts tokens from ONE repository and ONE branch, and the deploy account can only deploy.
#
# Usage:  PROJECT_ID=my-project REPO=owner/name ./scripts/setup-github-deploy.sh
# Optional: BRANCH (default main), REGION (default us-central1)
# Needs: gcloud signed in with permission to manage IAM, and gh signed in with access to the repo.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REPO="${REPO:?Set REPO as owner/name}"
BRANCH="${BRANCH:-main}"
POOL="github"
PROVIDER="github-oidc"
SA_NAME="github-deployer"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Project $PROJECT_ID  Repo $REPO  Branch $BRANCH"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  run.googleapis.com artifactregistry.googleapis.com --project "$PROJECT_ID"

# The account the workflow acts as
gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deployer" --project "$PROJECT_ID"

# What it may do: manage Cloud Run revisions, push images, and run them as the service's own account
for ROLE in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser --project "$PROJECT_ID" >/dev/null

# Trust GitHub's tokens, but only for this repository and branch
gcloud iam workload-identity-pools describe "$POOL" --location=global --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions" --project "$PROJECT_ID"

gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" --project "$PROJECT_ID" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${REPO}' && assertion.ref=='refs/heads/${BRANCH}'"

gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" >/dev/null

PROVIDER_NAME="$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" --project "$PROJECT_ID" --format='value(name)')"

# These are identifiers, not secrets, so they are stored as repository variables
gh variable set GCP_PROJECT_ID --body "$PROJECT_ID" --repo "$REPO"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "$PROVIDER_NAME" --repo "$REPO"
gh variable set GCP_SERVICE_ACCOUNT --body "$SA" --repo "$REPO"

echo
echo "Done. Pushes to '$BRANCH' will now be verified and deployed by .github/workflows/deploy.yml"
