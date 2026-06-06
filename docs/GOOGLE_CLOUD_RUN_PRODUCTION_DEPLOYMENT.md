# Google Cloud Run Production Deployment Plan

## Purpose

This document describes a production-grade deployment plan for the mortgage affordability automation service using Google Cloud Run. It is based on the current project architecture and the target operating model:

- 50 customer cases per day.
- Each customer case runs against 50 lenders.
- Average lender calculation time: 30 seconds.
- Target completion window for a complete customer case: 60-90 seconds.
- Cost focus: Cloud Run compute, result/evidence storage, and database/run-state storage.

The current codebase is a TypeScript/Node.js Playwright service. It accepts lender-ready JSON, selects a lender adapter, drives the lender calculator in a browser, extracts the affordability result, and returns a normalized response with screenshot evidence.

## Executive Recommendation

Deploy this project on Google Cloud Run as two service types:

1. API/orchestrator service.
2. Lender worker service.

The API service should not run all 50 lenders itself. It should validate the request, create a case record, enqueue one task per lender, and return a `caseId`. The worker service should process exactly one lender task per request and write its result independently.

Recommended first production architecture:

```text
Client / Internal System
  -> Cloud Run API service
      -> Firestore case + lender task records
      -> Cloud Tasks fanout: 50 tasks per case
          -> Cloud Run lender-worker service
              -> Playwright browser run
              -> Cloud Storage screenshot/evidence
              -> Firestore lender result
      -> Aggregated final output via GET /cases/:caseId
```

This architecture gives the project the concurrency needed for 50 lenders, isolates lender failures, and keeps costs tied to actual calculator runtime.

## Why Cloud Run Fits This Workload

Cloud Run is valuable here because this workload is containerized, bursty, and naturally parallel.

| Requirement | Cloud Run Fit |
| --- | --- |
| Run Node.js plus Playwright/Chromium | Package all runtime dependencies into one Docker image. |
| Complete 50 lenders quickly | Scale horizontally to many worker instances. |
| Keep cost controlled | Request-based billing charges mainly while requests are active. |
| Isolate failures | One lender task can fail without killing the whole case. |
| Avoid server management | No VM patching, autoscaler management, or Kubernetes control plane. |
| Control blast radius | Set max instances, concurrency, timeouts, and queue dispatch limits. |
| Production operations | Built-in logs, metrics, revisions, rollbacks, IAM, and health checks. |

Cloud Run request-based pricing charges only for resources used, rounded to the nearest 100 ms. Google documents that request-based Cloud Run services are billed while starting, shutting down, or processing at least one request. If minimum instances are configured, idle warm instances are charged at a lower idle rate.

Sources:

- Cloud Run pricing: https://cloud.google.com/run/pricing
- Cloud Run autoscaling: https://docs.cloud.google.com/run/docs/about-instance-autoscaling
- Cloud Run concurrency: https://docs.cloud.google.com/run/docs/about-concurrency
- Cloud Run timeouts: https://docs.cloud.google.com/run/docs/configuring/request-timeout

## Current Implementation Status

The project now has two execution modes:

- Local/demo mode can run the registered mapped lenders inline from the Express API.
- Production fanout mode creates a run state record, enqueues one Cloud Tasks task per registered lender, runs each lender through `POST /worker/lender-task`, and stores run state in Firestore when `RUN_STATE_BACKEND=firestore`.

Current implemented flow:

```text
POST /api/cases/:caseId/run-affordability
  -> load raw case from samples/test-cases
  -> map raw case to all registered lender inputs
  -> create run record
  -> either run inline batches or enqueue lender tasks
  -> return aggregate results or 202 with runId

POST /worker/lender-task
  -> run exactly one lender
  -> upload evidence when EVIDENCE_BUCKET is configured
  -> write one lender result

GET /api/runs/:runId
  -> return aggregate run state and lender results
```

Required production behavior:

```text
POST /cases
  -> validate full case
  -> create run/case record
  -> enqueue 50 lender tasks
  -> return caseId quickly

POST /worker/lender-task
  -> run exactly one lender
  -> write one lender result
  -> upload evidence

GET /cases/:caseId
  -> return aggregate state and all lender results
```

Local runs still write screenshots and failure bundles to disk. When `EVIDENCE_BUCKET` is configured, the Cloud Storage artifact store uploads screenshots, PDFs, and failure bundles and records `gs://` evidence URIs for API retrieval.

## Target Runtime Design

### API Service

Purpose:

- Authenticate requests.
- Validate lender-ready input.
- Create case/run records.
- Fan out one task per lender.
- Return case status and final aggregate output.

Suggested Cloud Run settings:

| Setting | Value |
| --- | --- |
| CPU | 1 vCPU |
| Memory | 512 MiB to 1 GiB |
| Concurrency | 20-80 |
| Min instances | 1 |
| Max instances | 5-10 initially |
| Timeout | 30 seconds |
| Billing | Request-based |

The API should stay lightweight. It should not run browsers.

### Lender Worker Service

Purpose:

- Receive one lender task.
- Run exactly one adapter.
- Enforce per-lender timeout.
- Upload screenshot/evidence.
- Write result.

Suggested Cloud Run settings:

| Setting | Value |
| --- | --- |
| CPU | 2 vCPU |
| Memory | 4 GiB |
| Concurrency | 1 initially |
| Max instances | 60 |
| Min instances | 0 for cheapest baseline, 5-10 for stronger latency |
| Request timeout | 90 seconds |
| Internal lender timeout | 45-60 seconds |
| Billing | Request-based |

Start with `concurrency=1` because each Playwright browser is memory-heavy and lender automation is not yet proven safe with multiple browser runs inside one container. After benchmarking, test `concurrency=2` to reduce cost.

Cloud Run can configure concurrency per instance, and Google documents that lower concurrency is appropriate when code cannot safely process parallel requests in the same instance.

## 60-90 Second Completion Strategy

The service can meet the 60-90 second target only by running lender calculations in parallel.

Expected production flow:

```text
T+0s    Client submits case
T+1s    API validates input and creates case record
T+2s    API enqueues 50 lender tasks
T+2-10s Cloud Run starts or reuses worker capacity
T+10-40s Workers run lender calculators
T+40-70s Results arrive and aggregate
T+60-90s Case completes or returns partial completion with failed/timed-out lenders
```

For average 30-second lender runtime, a full case needs around 50 concurrent browser slots to finish in one wave.

Recommended initial capacity:

```text
worker concurrency = 1
worker max instances = 60
required one-wave capacity = 50 instances
```

This provides enough headroom for 50 lenders plus retries, slow starts, or brief autoscaling delay.

## Failure Isolation Model

Each lender must be independent.

Do not design the production path as:

```text
Promise.all(50 lender runs inside one API process)
```

Use:

```text
50 separate queue tasks
50 separate worker requests
50 separate result records
```

If one lender fails, only that lender task fails.

Example aggregate result:

```json
{
  "caseId": "case_123",
  "status": "completed_with_failures",
  "deadlineMs": 90000,
  "summary": {
    "totalLenders": 50,
    "successful": 48,
    "failed": 1,
    "timedOut": 1
  },
  "results": {
    "halifax": {
      "status": "success",
      "maximumBorrowing": 250000
    },
    "santander": {
      "status": "failed",
      "error": {
        "category": "lender_unavailable",
        "message": "Calculator did not load within timeout."
      }
    }
  }
}
```

Failure handling rules:

| Failure | Action |
| --- | --- |
| Validation failure | Do not retry. Return actionable validation error. |
| Field mapping failure | Do not retry automatically. Mark as adapter bug. |
| Browser crash | Retry once on a fresh worker. |
| Navigation timeout | Retry once or twice with backoff. |
| Lender unavailable | Mark lender unavailable; do not block other lenders. |
| Repeated lender failures | Open circuit for that lender temporarily. |
| Case deadline reached | Return partial result with late lenders marked timed out. |

## Data Storage Model

### Firestore

Firestore is the recommended first database because this workflow is document-shaped and write-light at the projected volume.

Collections:

```text
cases/{caseId}
  status
  createdAt
  completedAt
  deadlineAt
  applicantRef / redacted identifiers
  lenderCount
  successCount
  failureCount

cases/{caseId}/lenderResults/{lenderId}
  lender
  status
  maximumBorrowing
  monthlyPayment
  messages
  error
  evidenceObjectPath
  startedAt
  completedAt
  durationMs
  attemptCount
```

Firestore pricing is based on document reads, writes, deletes, storage, index reads, and network bandwidth. The documented free tier includes one free database per project, 1 GiB stored data, 50,000 reads/day, 20,000 writes/day, and 20,000 deletes/day.

Source: https://firebase.google.com/docs/firestore/pricing

At 50 cases/day and 50 lenders/case:

```text
2,500 lender result records/day
75,000 lender result records/month
```

Estimated Firestore writes:

```text
Per lender task:
  1 write: task started
  1 write: task completed

Per case:
  1 write: case created
  1 write: case completed
  optional aggregate counter updates
```

Expected write volume:

```text
2,500 lender tasks/day * 2 writes = 5,000 writes/day
plus case records and counters
```

This is comfortably below Firestore's documented 20,000 free writes/day for one eligible database, assuming the implementation avoids excessive polling/counter writes.

### Cloud Storage

Use Cloud Storage for:

- Failure screenshots.
- Optional success screenshots.
- Optional Playwright traces.
- Final case output archives if required for audit.

Recommended bucket layout:

```text
gs://mortgage-affordability-prod-evidence/
  cases/{yyyy}/{mm}/{dd}/{caseId}/{lenderId}/screenshot.png
  cases/{yyyy}/{mm}/{dd}/{caseId}/{lenderId}/trace.zip
  cases/{yyyy}/{mm}/{dd}/{caseId}/final-result.json
```

Retention recommendation:

| Artifact | Retention |
| --- | --- |
| Final JSON result | 1-7 years, depending compliance need |
| Failure screenshots | 90 days minimum |
| Success screenshots | 7-30 days, or disabled unless audit mode is enabled |
| Playwright traces | Failure-only, 7-30 days |

Cloud Storage pricing is based on stored data, processing/operations, and network usage. Standard regional storage is suitable for this workload.

Source: https://cloud.google.com/storage/pricing

## Cost Assumptions

This estimate focuses on:

- Cloud Run worker compute.
- Small API compute.
- Cloud Storage for final output and screenshots.
- Firestore for run status and results.

It excludes:

- Custom domain/DNS.
- Cloud Armor/WAF.
- Support plan.
- Developer CI/CD build minutes.
- Excessive log retention.
- Human operations cost.
- Any paid third-party proxy/browser service.

Primary workload:

```text
50 cases/day
50 lenders/case
2,500 lender runs/day
30-day month
75,000 lender runs/month
Average lender runtime: 30 seconds
Worker size: 2 vCPU / 4 GiB
Worker concurrency: 1
Region planning target: europe-west2 / London
```

Cloud Run's pricing page lists request-based active CPU at `$0.000024` per vCPU-second, active memory at `$0.0000025` per GiB-second, and requests at `$0.40` per million after free tier. The same page lists London (`europe-west2`) under Tier 2 regions, so this document uses a conservative 1.4x uplift for London planning:

```text
Conservative CPU:    $0.0000336 per vCPU-second
Conservative memory: $0.0000035 per GiB-second
```

Confirm final numbers with the Google Cloud Pricing Calculator before purchase.

## Compute Cost Calculation

Per lender run:

```text
2 vCPU * 30 sec * $0.0000336 = $0.002016
4 GiB  * 30 sec * $0.0000035 = $0.000420

Total per lender run = $0.002436
```

Per full 50-lender case:

```text
50 lenders * $0.002436 = $0.1218
```

Daily active worker compute:

```text
50 cases/day * $0.1218 = $6.09/day
```

Monthly active worker compute:

```text
75,000 lender runs/month * $0.002436 = $182.70/month
```

API service compute should be small because it only validates, enqueues, and reads/writes state. Budget:

```text
API service: $5-$15/month
```

Cloud Tasks request charges should be negligible at this volume. Cloud Tasks pricing gives the first 1 million billable operations free and then $0.40 per million. 50 cases/day creates around 75,000 task creations/month plus push attempts, still likely within the free tier.

Source: https://cloud.google.com/tasks/pricing

## Storage Cost Calculation

### Screenshots

Assume one screenshot for every lender run:

```text
75,000 screenshots/month
Average screenshot size: 500 KB
Total new screenshot data/month: 37.5 GB
```

Cloud Storage standard regional pricing is low enough that 37.5 GB is not the main cost driver. Using the published regional Standard storage rate as a planning reference:

```text
37.5 GB * roughly $0.02-$0.03/GB-month = about $1-$2/month
```

Operations cost:

```text
75,000 object writes/month
Class A operations are charged per 1,000 operations
Expected charge: low single-digit dollars or less
```

Practical screenshot storage budget:

```text
All screenshots retained 30 days: $2-$10/month
Failure-only screenshots: usually <$2/month
```

### Final JSON Outputs

Assume each lender result is 5-20 KB and each full case result is 250 KB to 1 MB.

Monthly final output storage:

```text
1,500 cases/month * 1 MB = 1.5 GB/month
```

Practical final-output storage budget:

```text
$1-$5/month
```

## Database Cost Calculation

Firestore expected daily writes:

```text
2,500 lender tasks/day * 2 writes = 5,000 writes/day
50 case records/day * 2 writes = 100 writes/day
counter/status updates = implementation-dependent
```

Expected daily reads depend on polling. Avoid aggressive polling from clients. Use:

- `GET /cases/:caseId` with sensible client polling interval.
- Optional server-sent events or WebSocket later if needed.
- Cached aggregate status on the case document.

Practical Firestore budget:

```text
$0-$10/month for this volume if polling is controlled
$10-$25/month with heavier dashboard reads, TTL, backups, or PITR
```

## Monthly Cost Summary

Baseline production estimate with 30-second average lender runtime:

| Component | Monthly Estimate |
| --- | ---: |
| Cloud Run worker active compute | ~$183 |
| Cloud Run API compute | ~$5-$15 |
| Cloud Tasks | ~$0 |
| Firestore run/result state | ~$0-$25 |
| Cloud Storage screenshots + final outputs | ~$3-$15 |
| Practical safety buffer | ~$25-$60 |
| Total | **~$225-$300/month** |

Production planning number:

```text
$250/month baseline
$300/month with conservative buffer
```

This estimate assumes no always-on warm worker capacity. If the business requires stronger first-case latency, add minimum instances during business hours.

## Optional Warm Worker Cost

Warm workers reduce cold-start latency by keeping Cloud Run instances ready before requests arrive. They are useful if the first case of the day must reliably finish in 60-90 seconds.

Do not keep 50 warm workers running all month initially. Start with a scheduled minimum instance policy during business hours only.

Planning example:

```text
10 warm worker instances
2 vCPU / 4 GiB each
Business hours only
```

Approximate add-on:

| Warm Strategy | Extra Monthly Cost |
| --- | ---: |
| No warm workers | $0 |
| 5-10 warm workers during business hours | ~$80-$180 |
| 10 warm workers always on | ~$400-$550 |
| 50 warm workers always on | Not recommended initially |

Recommended first setting:

```text
Min instances = 0 outside working hours
Min instances = 5-10 during working hours
Max instances = 60
```

This balances cost and latency.

## Production Reliability Controls

### Timeouts

Set layered timeouts:

```text
Cloud Run worker request timeout: 90 seconds
Internal Playwright timeout: 45-60 seconds
Case-level aggregation deadline: 90 seconds
```

Cloud Run allows request timeouts from 1 second up to 60 minutes, with a default of 5 minutes.

### Retries

Retry only transient errors:

```text
Retry:
  navigation timeout
  browser crash
  temporary 5xx response
  lender unavailable page

Do not retry:
  validation error
  required field missing
  adapter field-fill bug
  result extraction guard failure
```

### Circuit Breakers

Track lender health over rolling windows:

```text
If lender success rate < threshold:
  mark lender degraded
  reduce dispatch rate
  optionally skip for short period
  alert engineering
```

### Rate Limits

Use one queue per lender or lender group:

```text
queue-halifax
queue-barclays
queue-santander
...
```

This allows per-lender limits:

- Max concurrent dispatches.
- Max dispatches per second.
- Retry backoff.

This avoids overloading one lender site and prevents one broken lender from consuming all worker capacity.

## Security And Compliance

Mortgage affordability data is sensitive. Production must treat it as regulated personal/financial data.

Required controls:

- Authenticate all API requests.
- Use IAM between Cloud Tasks and worker service.
- Do not expose worker endpoint publicly.
- Store secrets in Secret Manager.
- Do not log borrower names, income, dates of birth, addresses, or raw request payloads.
- Encrypt Cloud Storage buckets with default encryption or CMEK if required.
- Apply lifecycle retention to screenshots/traces.
- Use signed URLs or authenticated proxy for evidence access.
- Use least-privilege service accounts.
- Enable audit logs for evidence bucket and database access.

## Observability

Track metrics by lender:

- Success rate.
- Failure rate by error category.
- p50/p95/p99 runtime.
- Timeout count.
- Retry count.
- Screenshot capture success.
- Browser crash count.
- Queue age.
- Worker cold-start/startup latency.

Minimum alerting:

| Alert | Threshold |
| --- | --- |
| Case p95 duration | > 90 seconds for 15 minutes |
| Lender success rate | < 90% over 30 minutes |
| Worker crash rate | > 3 crashes in 10 minutes |
| Queue age | > 60 seconds |
| Error spike | Any lender has sudden `field_fill` or `result_extraction` spike |

## Implementation Roadmap

### Phase 1: Containerize

- Add Dockerfile using Playwright-compatible base image.
- Build TypeScript during image build.
- Run `npm ci`.
- Install Playwright browsers/dependencies.
- Add `/health` endpoint.
- Confirm one lender run works inside container.

### Phase 2: Split API And Worker

- Replace single `/runs` production path with `/cases`.
- Add worker endpoint such as `/worker/lender-task`.
- Ensure each worker request runs one lender only.
- Make worker idempotent by `caseId + lenderId + attempt`.

### Phase 3: Add State Store

- Add Firestore case documents.
- Add lender result subcollection.
- Add aggregate status updates.
- Add TTL/retention strategy.

### Phase 4: Add Evidence Storage

- Replace local screenshot path with Cloud Storage object upload.
- Store object path in result.
- Add lifecycle policy.
- Make screenshots failure-only by default, with optional success evidence.

### Phase 5: Add Queue

- Add Cloud Tasks queue creation.
- Add one task per lender.
- Add signed/OIDC-authenticated worker invocation.
- Configure retry rules by error category.

### Phase 6: Production Hardening

- Add structured logs with request IDs and no PII.
- Add metrics and alerts.
- Add circuit breakers.
- Add per-lender rate limits.
- Add smoke tests per lender.
- Add deployment rollback process.

### Phase 7: Benchmark And Tune Cost

- Measure memory per lender.
- Measure p50/p95/p99 duration per lender.
- Test worker memory at 2 GiB vs 4 GiB.
- Test concurrency 1 vs 2.
- Test min instances 0 vs scheduled 5-10.
- Recalculate monthly cost from real billable instance time.

## Decision Summary

Use Google Cloud Run for production, but do not deploy the current synchronous API shape directly.

The production system should be:

```text
Cloud Run API + Cloud Tasks + Cloud Run worker + Firestore + Cloud Storage
```

At the stated workload and 30-second average lender runtime, the expected monthly cost for compute, storage, and database is:

```text
Baseline:       ~$225-$300/month
Planning value: ~$250/month
With business-hour warm workers: add ~$80-$180/month
```

This design gives the project the best balance of cost efficiency, operational reliability, and 60-90 second completion potential for 50 lenders.
