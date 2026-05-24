# Cloud Run Demo Deployment Runbook

This runbook deploys the current Express web UI/API as one private Cloud Run service for demo validation.

## Service Settings

```text
Service: mortgage-affordability-demo
Region: europe-west2
Authentication: required
CPU: 2
Memory: 4Gi
Timeout: 900s
Concurrency: 1
Max instances: 3
Min instances: 0
```

Environment:

```text
HEADLESS=true
BROWSER_EXECUTION_MODE=managed
AUTOMATION_TIMEOUT_MS=60000
SCREENSHOT_DIR=/tmp/screenshots
```

## Deploy From Cloud Shell

Upload or clone this repository into Cloud Shell, then run:

```bash
gcloud config set project PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

gcloud run deploy mortgage-affordability-demo \
  --source . \
  --region europe-west2 \
  --no-allow-unauthenticated \
  --cpu 2 \
  --memory 4Gi \
  --timeout 900 \
  --concurrency 1 \
  --max-instances 3 \
  --set-env-vars HEADLESS=true,BROWSER_EXECUTION_MODE=managed,AUTOMATION_TIMEOUT_MS=60000,SCREENSHOT_DIR=/tmp/screenshots
```

Replace `PROJECT_ID` with the Google Cloud project ID.

## Private Smoke Tests

Fetch the service URL:

```bash
SERVICE_URL="$(gcloud run services describe mortgage-affordability-demo --region europe-west2 --format='value(status.url)')"
echo "$SERVICE_URL"
```

Verify health with an authenticated request:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$SERVICE_URL/health"
```

Verify cases:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$SERVICE_URL/api/cases"
```

For browser UI testing through Cloud Shell:

```bash
gcloud run services proxy mortgage-affordability-demo --region europe-west2 --port 8080
```

Then open the Cloud Shell web preview for port `8080`.

## Five-Lender Demo Run

Choose a case ID from `GET /api/cases`, then run:

```bash
CASE_ID="01-ftb-single-employed"

curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  "$SERVICE_URL/api/cases/$CASE_ID/run-affordability"
```

The demo is acceptable when all five mapped lenders return either `success` or a structured `failed` result and the Cloud Run service does not crash.
