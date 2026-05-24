# Web Interface

This document covers only the simple browser interface added for viewing Halifax mapped cases and running affordability across the mapped lenders. Backend adapter behavior and lender field mapping remain documented separately in the existing backend and field-map docs.

## Purpose

The interface provides a small local page for:

- Viewing Halifax mapped cases in rows.
- Opening a case detail view.
- Seeing lender affordability results for the selected case.
- Running affordability for the selected case across the five mapped lenders.

The UI is intentionally minimal and does not use a frontend framework.

## Files

```text
public/index.html   Static HTML, CSS, and browser JavaScript for the interface.
src/server.ts       Serves the static page and exposes interface API routes.
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

The Cases page reads cases only from:

```text
samples/halifax-mapped-cases
```

The UI ignores generic duplicate filenames like:

```text
case-01.json
```

Case display names are derived from filenames. For example:

```text
halifax-raw-case-11-ftb-joint-employed-contractor-umbrella.json
```

becomes:

```text
11 Ftb Joint Employed Contractor Umbrella
```

## Supported Interface Lenders

The Run affordability button uses only the five lenders that currently have mapping workbooks and mapped sample flow support:

```text
barclays
halifax
hsbc
skipton
virgin_money
```

These correspond to files in:

```text
Mapping_xlxs/Barclays.xlsx
Mapping_xlxs/Halifax mapping.xlsx
Mapping_xlxs/HSBC.xlsx
Mapping_xlxs/skipton.xlsx
Mapping_xlxs/virgin_money.xlsx
```

## Lender Input Lookup

The page lists cases from `samples/halifax-mapped-cases`, but the run endpoint looks for matching mapped input files in lender-specific folders.

Lookup folders:

```text
barclays      samples/barclays-mapped-cases, samples/barclays-additional-mapped-cases
halifax       samples/halifax-mapped-cases
hsbc          samples/hsbc-mapped-cases, samples/hsbc-additional-mapped-cases
skipton       samples/skipton-mapped-cases, samples/skipton-additional-mapped-cases
virgin_money  samples/virgin-money-mapped-cases, samples/virgin-money-additional-mapped-cases
```

The matching key is the normalized case id derived from the filename, after removing prefixes such as:

```text
halifax-raw-case-
barclays-raw-case-
additional-raw-case-
```

If a mapped input is missing for a lender, that lender row is marked failed with:

```text
No mapped input found for this lender and case.
```

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
      "lendersRun": 5
    }
  ]
}
```

### `GET /api/cases/:caseId`

Returns one case detail view with all five interface lenders.

Each lender row can be:

```text
success   Affordability amount was extracted.
failed    Lender run failed or mapped input is missing.
not_run   No run result is saved in the current server session.
```

### `POST /api/cases/:caseId/run-affordability`

Runs the selected case across all five interface lenders.

The five lender runs are started in parallel:

```ts
Promise.all(mappedLenders.map((lender) => runMappedLenderForCase(caseId, lender)))
```

In managed browser mode, each adapter creates its own browser session. This means the five lender automations can run at the same time instead of one after another.

The endpoint responds after all five lenders complete or fail.

## UI Flow

1. User opens `http://localhost:3000`.
2. The Cases page calls `GET /api/cases`.
3. User clicks a case row to view lender result rows.
4. User clicks `Run affordability` from the Cases page.
5. The page calls `POST /api/cases/:caseId/run-affordability`.
6. The button changes to `Running...` while the endpoint is active.
7. After completion, the page navigates to the selected case detail view.
8. The case detail view displays the latest in-memory result for each lender.

## Result Storage

Run results are stored in memory only:

```text
const runResults = new Map<string, AffordabilityResult>();
```

This means:

- Results are visible while the server process is running.
- Results disappear when the server restarts.
- There is no database or persisted run history.

## Timeout Behavior

The interface uses the same automation timeout as the backend adapters.

Default:

```text
AUTOMATION_TIMEOUT_MS=60000
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
The run endpoint is synchronous and waits for all five lenders before responding.
There is no per-lender live progress streaming yet.
Results are not persisted after restart.
The Cases page is intentionally limited to Halifax mapped cases.
The interface only runs the five mapped workbook lenders, not every adapter in the registry.
```

## Suggested Next Interface Improvements

```text
Add live per-lender progress updates.
Add selected-lender checkboxes.
Persist results to JSON or a database.
Add a run history page.
Add retry for a single failed lender.
Add clear status labels for running, timeout, missing input, and lender validation failure.
```
