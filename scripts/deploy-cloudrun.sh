#!/usr/bin/env bash
# Deploys Bar Raiser to Google Cloud Run. See "Deploy on Google Cloud Run" in README.md.
#
# Usage:  MONGODB_URI='mongodb+srv://...' PROJECT_ID=my-project ./scripts/deploy-cloudrun.sh
# Optional: REGION (default us-central1, a region covered by the Cloud Run free tier), SERVICE (default bar-raiser)
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project id}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-bar-raiser}"
SECRET="${SECRET:-bar-raiser-mongodb-uri}"

echo "Project: $PROJECT_ID  Region: $REGION  Service: $SERVICE"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$PROJECT_ID"

# The connection string goes in Secret Manager, never in the image or in plain environment variables
if [ -n "${MONGODB_URI:-}" ]; then
  if gcloud secrets describe "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s' "$MONGODB_URI" | gcloud secrets versions add "$SECRET" --data-file=- --project "$PROJECT_ID" >/dev/null
  else
    printf '%s' "$MONGODB_URI" | gcloud secrets create "$SECRET" --data-file=- --replication-policy=automatic --project "$PROJECT_ID" >/dev/null
  fi
elif ! gcloud secrets describe "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Set MONGODB_URI the first time you deploy." >&2
  exit 1
fi

# Let the Cloud Run service account read the secret
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# New projects no longer give the default service account enough rights to build from source
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role=roles/cloudbuild.builds.builder --condition=None >/dev/null
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role=roles/secretmanager.secretAccessor --project "$PROJECT_ID" >/dev/null

# --timeout 3600: live interviews are one long WebSocket request, and the default (5 minutes) would cut them off
# --max-instances: caps cost and keeps the in-memory rate limits meaningful
# --cpu-throttling is left at the default; a live WebSocket counts as an active request, so CPU is available during interviews
gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --timeout 3600 \
  --concurrency 40 \
  --cpu 1 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 3 \
  --set-secrets "MONGODB_URI=${SECRET}:latest" \
  --set-env-vars "NODE_ENV=production"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo
echo "Deployed: $URL"
echo "Health:   $URL/healthz"
