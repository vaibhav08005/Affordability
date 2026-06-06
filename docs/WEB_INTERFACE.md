# Web Interface

This document covers the browser interface for viewing production raw cases, mapping them to lenders, and running affordability across all mapped lenders. Backend adapter behavior and lender field mapping remain documented separately in the existing backend and field-map docs.

## Purpose

The interface provides a small local page for:

- Viewing production raw cases in rows.
- Opening a case detail view.
- Viewing the raw source YAML/JSON for a case when available.
- Seeing lender affordability results for the selected case.
- Opening screenshot/PDF evidence artifacts for saved runs.
- Running affordability for the selected case across all nine mapped lenders.
- Polling asynchronous run progress when worker fanout is enabled.

The UI is intentionally minimal and does not use a frontend framework.

## Files

```text
public/index.html   Static HTML, CSS, and browser JavaScript for the interface.
src/server.ts       Serves the static page and exposes interface API routes.
src/repositories/run-repository.ts
                    In-memory recent result storage for direct /runs and inline runs.
src/repositories/run-state.ts
                    Case-run and per-lender run-state repository contract.
src/repositories/firestore-run-state-repository.ts
                    Firestore-backed run-state implementation for production fanout.
```

The page is served by the same Express process as the API.

## Run Locally

Start the project:

```powershell
cd C:\Users\vsont\OneDrive\Desktop\Codex
npm.cmd run api
```

Open:

```text
http://localhost:3000
```

To show lender browser automation windows:

```powershell
$env:HEADLESS="false"
npm.cmd run api
```

## Case Data Source

The Cases page reads production raw cases from:

```text
samples/test-cases
```

Case display names are derived from filenames. For example:

```text
additional-raw-case-45-joint-home-mover-high-variable-income-btl-surplus.yaml
```

becomes:

```text
45 Joint Home Mover High Variable Income Btl Surplus
```

The raw input viewer returns the same source YAML/JSON text from `samples/test-cases`.

## Supported Interface Lenders

The Run affordability button uses all nine mapped lenders:

```text
barclays
halifax
hsbc
kensington
natwest
nationwide
santander
skipton
virgin_money
```

These correspond to files in:

```text
Mapping_xlxs/Barclays.xlsx
Mapping_xlxs/Halifax mapping.xlsx
Mapping_xlxs/HSBC.xlsx
Mapping_xlxs/kensington.xlsx
Mapping_xlxs/natwest.xlsx
Mapping_xlxs/nationwide.xlsx
Mapping_xlxs/santander.xlsx
Mapping_xlxs/skipton.xlsx
Mapping_xlxs/virgin_money.xlsx
```

## Lender Input Lookup

The run endpoint no longer reads pre-generated mapped JSON files. For each selected case, the server reads the raw YAML/JSON from `samples/test-cases`, applies the in-memory mapper for each lender, validates the mapped `LenderReadyInput`, and passes that input to the adapter.

The matching key is the normalized case id derived from the raw filename, after removing prefixes such as `halifax-raw-case-`, `<lender>-raw-case-`, `additional-raw-case-`, and `case-`.

## Interface Routes

### `GET /`

Serves `public/index.html`.

### `GET /api/cases`

Returns the case list for the Cases page.

Response shape:

```json
{
  "cases": [
    {
      "id": "01-ftb-single-employed",
      "title": "01 Ftb Single Employed",
      "mortgagePurpose": "Purchase",
      "applicationType": "Single",
      "loanAmount": 235000,
      "propertyValue": 280000,
      "lendersRun": 9
    }
  ]
}
```

### `GET /api/cases/:caseId`

Returns one case detail view with all nine interface lenders. If there is a recent run for the case, the response can include `latestRun`.

Each lender row can be:

```text
success   Affordability amount was extracted.
failed    Lender run failed or mapped input is missing.
queued    Lender task has been queued.
running   Lender task is currently running.
timed_out Lender task timed out.
not_run   No run result is saved in the current server session.
```

### `GET /api/cases/:caseId/input`

Returns the raw source YAML/JSON text for the selected case when a matching raw input exists.

Response shape:

```json
{
  "caseId": "01-ftb-single-employed",
  "fileName": "halifax-raw-case-01-ftb-single-employed.yaml",
  "format": "yaml",
  "content": "..."
}
```

### `GET /api/artifact?path=...`

Serves screenshot or PDF evidence from allowed local artifact roots:

```text
artifacts/
SCREENSHOT_DIR
```

The route rejects paths outside those roots.

### `GET /api/artifact?uri=gs://...`

Streams screenshot/PDF evidence from Cloud Storage. The URI must be in the configured `EVIDENCE_BUCKET`.

### `POST /api/cases/:caseId/run-affordability`

Runs the selected case across all nine interface lenders.

Local inline mode runs lenders in batches:

```ts
runMappedLendersForCaseInBatches(caseId)
```

The inline batch size is controlled by:

```text
LENDER_RUN_BATCH_SIZE
```

Default batch size is 3.

When `LENDER_WORKER_FANOUT=true` or Cloud Tasks is configured, the endpoint creates a run record, enqueues one lender task per lender, and returns `202` with a `runId`.

### `GET /api/runs/:runId`

Returns aggregate run state and current lender result rows for an asynchronous run. The UI polls this route every few seconds until the run reaches a terminal state.

### `POST /worker/lender-task`

Private worker endpoint used by Cloud Tasks. Each request runs exactly one lender for one case and writes the lender result back to the run-state repository.

## UI Flow

1. User opens `http://localhost:3000`.
2. The Cases page calls `GET /api/cases`.
3. User clicks a case row to view lender result rows.
4. User clicks `Run affordability` from the Cases page.
5. The page calls `POST /api/cases/:caseId/run-affordability`.
6. If the response includes a `runId`, the page navigates to `#run=<runId>` and polls `GET /api/runs/:runId`.
7. If no `runId` is returned, the page navigates to the selected case detail view after inline completion.
8. The case detail view displays the latest in-memory or repository-backed result for each lender.
9. User can open raw input and evidence links when available.

## Result Storage

Inline/direct run results are accessed through:

```text
src/repositories/run-repository.ts
```

Case-run progress and worker fanout results are accessed through:

```text
src/repositories/run-state.ts
src/repositories/firestore-run-state-repository.ts
```

Local default:

```text
InMemoryRunRepository
InMemoryRunStateRepository
```

Production/fanout:

```text
FirestoreRunStateRepository
CloudTasksLenderTaskDispatcher
Cloud Storage evidence upload when EVIDENCE_BUCKET is set
```

Run state is retained for 24 hours by timestamp convention in the app layer. Firestore TTL policy should be configured separately if automatic deletion is required.

```text
getLenderResult(caseId, lender)
saveLenderResult(caseId, result)
```

## Timeout Behavior

The interface uses the same automation timeout as the backend adapters.

Default:

```text
AUTOMATION_TIMEOUT_MS=30000
```

This is a per-action/default Playwright timeout, not a total time limit for a complete lender run.

To reduce it:

```powershell
$env:AUTOMATION_TIMEOUT_MS="30000"
npm.cmd run api
```

## Current Limitations

```text
The interface has no authentication.
Inline local mode is synchronous by batch; fanout mode is asynchronous and polled.
There is no push/live streaming yet; polling is used.
Local default results are not persisted after restart.
Production durability requires RUN_STATE_BACKEND=firestore and EVIDENCE_BUCKET.
The Cases page is intentionally limited to samples/test-cases.
The raw input viewer depends on filename-derived case IDs matching the production raw cases.
```

## Suggested Next Interface Improvements

```text
Add push-based per-lender progress updates.
Add selected-lender checkboxes.
Add a run history page.
Add retry for a single failed lender.
Add clear status labels for running, timeout, missing input, and lender validation failure.
```
