# Detailed Project Plan

## Goal

Build an automation platform that fills UK lender affordability calculators from lender-ready JSON and returns normalized affordability results.

## Non-Goals For This Phase

- Convert raw mortgage fact-find data into lender-ready JSON.
- Replace lender affordability engines.
- Bypass CAPTCHA, anti-bot controls, authentication challenges, or lender access controls.

## Phase 1: Halifax Proof Of Concept

1. Define the common input contract.
2. Define the common output contract.
3. Implement the lender adapter interface.
4. Implement the Halifax adapter for the first calculator flow.
5. Capture evidence: screenshot, timestamp, calculator messages.
6. Add error categories: validation, navigation, field fill, calculate, result extraction, lender unavailable.

Acceptance criteria:

- CLI can run one Halifax lender-ready JSON file.
- Browser opens the Halifax calculator directly or reports a lender availability block with evidence.
- Adapter fills a simple successful case.
- Adapter extracts result or a structured failure.
- The output always follows the shared result contract.

Current implementation status:

- Shared input/output contracts are implemented.
- CLI and HTTP API entry points are implemented.
- Halifax adapter is implemented as the first lender adapter.
- Evidence screenshots and structured error categories are implemented.
- Halifax returns a system-problem page to fresh managed Playwright sessions in this environment.
- Attached browser execution is implemented over Chrome DevTools Protocol.
- Halifax attached-mode end-to-end run is verified: the adapter fills the live calculator, submits it, waits for results, and extracts maximum borrowing.

## Phase 2: Coverage Expansion

Add Halifax variations:

- One applicant and two applicants.
- Purchase, remortgage with no additional borrowing, remortgage with capital raising, further advance.
- Employed, self-employed, pension, other income.
- Dependants.
- Buy-to-let outgoings.
- Other owned properties.
- Interest-only and capital-and-interest scenarios.
- Shared ownership / shared equity.

Acceptance criteria:

- Test matrix covers expected field visibility and required fields.
- Adapter handles missing optional data safely.
- Failed runs include actionable diagnostics.

## Phase 3: API Service

Add an HTTP API.

Endpoints:

- `POST /runs`: start an affordability run.
- `GET /runs/:id`: retrieve status/result.
- `GET /health`: service health.

Security requirements:

- No borrower data in plain application logs.
- Request IDs for traceability.
- Encrypt or restrict access to screenshots and artifacts.
- Configurable retention period.

## Phase 3A: Browser Session Execution

Some lender calculators may reject fresh automation browser contexts while allowing normal broker browser sessions. Support two execution modes:

- `managed`: service launches its own Playwright browser context. Implemented.
- `attached`: service connects to a trusted browser profile/session prepared for the intermediary workflow over CDP. Implemented.

Rules:

- Do not bypass CAPTCHA, access controls, or lender security checks.
- Do not submit borrower data unless the run was explicitly requested.
- Store no credentials in source code.
- Use lender availability errors and retry policy when the calculator blocks or is down.

## Phase 4: Scale To 30+ Lenders

Add adapters one lender at a time.

Each lender must include:

- Field map.
- Conditional flow map.
- Transform rules.
- Result extraction rules.
- Known limitations.
- Regression cases.

## Phase 5: Deployment And Monitoring

Runtime:

- Containerized Node service.
- Playwright browser dependencies installed in image.
- Queue worker for longer calculator runs.

Monitoring:

- Run success rate by lender.
- Field failure rate by lender.
- Calculator availability.
- Average runtime.
- Screenshot capture rate.
- Alerting on repeated lender failures.

## Adapter Design

Each lender adapter is a small state machine:

```text
open -> dismiss overlays -> fill loan -> fill income -> fill outgoings -> calculate -> extract result
```

The shared service should not know Halifax field details. It only selects the adapter and handles orchestration.
