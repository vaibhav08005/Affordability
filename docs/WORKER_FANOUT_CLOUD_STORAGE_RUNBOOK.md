# Worker Fan-Out And Cloud Storage Runbook

## Production Shape

The production deployment now separates orchestration from lender execution:

- `mortgage-affordability-demo`: public web UI and API.
- `mortgage-affordability-worker`: private Cloud Run worker service.
- `lender-worker-queue`: Cloud Tasks queue in `europe-west2`.
- Firestore: durable case run and lender result state.
- Cloud Storage bucket: durable screenshots, PDFs, and failure bundles.

When a user runs affordability for a case, the API creates one Firestore run record and enqueues one Cloud Tasks task per lender. Each task invokes the private worker endpoint:

```text
POST /worker/lender-task
```

Each worker request runs exactly one lender automation, uploads evidence to Cloud Storage, and writes the final lender result back to Firestore. The UI follows the returned `runId` and polls:

```text
GET /api/runs/:runId
```

This avoids putting all lender browser sessions inside a single Cloud Run request.

## Google Cloud Resources

Project:

```text
project-2da37e36-5c70-4e06-9f7
```

Region:

```text
europe-west2
```

Queue:

```text
lender-worker-queue
```

Evidence bucket:

```text
gs://mortgage-affordability-evidence-project-2da37e36-5c70-4e06-9f7
```

Worker invoker service account:

```text
lender-worker-invoker@project-2da37e36-5c70-4e06-9f7.iam.gserviceaccount.com
```

## Runtime Configuration

Main API service:

```text
HEADLESS=true
BROWSER_EXECUTION_MODE=managed
AUTOMATION_TIMEOUT_MS=30000
SCREENSHOT_DIR=/tmp/screenshots
FAILURE_ARTIFACT_DIR=/tmp/failures
EVIDENCE_BUCKET=mortgage-affordability-evidence-project-2da37e36-5c70-4e06-9f7
RUN_STATE_BACKEND=firestore
LENDER_WORKER_FANOUT=true
PROJECT_ID=project-2da37e36-5c70-4e06-9f7
CLOUD_TASKS_LOCATION=europe-west2
CLOUD_TASKS_QUEUE=lender-worker-queue
WORKER_URL=https://mortgage-affordability-worker-476501925780.europe-west2.run.app/worker/lender-task
WORKER_INVOKER_SERVICE_ACCOUNT=lender-worker-invoker@project-2da37e36-5c70-4e06-9f7.iam.gserviceaccount.com
```

Worker service:

```text
HEADLESS=true
BROWSER_EXECUTION_MODE=managed
AUTOMATION_TIMEOUT_MS=30000
SCREENSHOT_DIR=/tmp/screenshots
FAILURE_ARTIFACT_DIR=/tmp/failures
EVIDENCE_BUCKET=mortgage-affordability-evidence-project-2da37e36-5c70-4e06-9f7
RUN_STATE_BACKEND=firestore
```

## Current Sizing

Main API:

```text
CPU: 1
Memory: 1Gi
Concurrency: 20
Max instances: 5
Timeout: 300s
Public access: enabled
```

Worker:

```text
CPU: 2
Memory: 4Gi
Concurrency: 1
Max instances: 20
Timeout: 120s
Public access: disabled
```

The worker has `concurrency=1` so one browser-heavy lender run gets an isolated request slot. Cloud Tasks controls dispatch pressure, and Cloud Run scales workers horizontally.

## Verification Commands

Health:

```powershell
Invoke-RestMethod https://mortgage-affordability-demo-476501925780.europe-west2.run.app/health
```

Start a run:

```powershell
$base = "https://mortgage-affordability-demo-476501925780.europe-west2.run.app"
$run = Invoke-RestMethod -Method Post "$base/api/cases/01-ftb-single-employed/run-affordability"
$run.runId
```

Poll a run:

```powershell
Invoke-RestMethod "$base/api/runs/$($run.runId)"
```

Check services:

```powershell
gcloud.cmd run services describe mortgage-affordability-demo --region europe-west2 --format="value(status.latestReadyRevisionName,status.url)"
gcloud.cmd run services describe mortgage-affordability-worker --region europe-west2 --format="value(status.latestReadyRevisionName,status.url)"
```

## Important Notes

- The API service no longer waits for all lenders inside the original request when `LENDER_WORKER_FANOUT=true`.
- A failed lender saves a structured failed result and does not block other lenders.
- Evidence links stream only from the configured `EVIDENCE_BUCKET`.
- Local `/tmp` evidence remains temporary; Cloud Storage is the durable evidence source.
- Firestore stores run progress, final lender outputs, timings, and evidence metadata.
