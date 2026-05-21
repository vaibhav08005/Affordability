# Project Handoff

This project automates UK mortgage intermediary affordability calculators with Playwright. It accepts a lender-ready JSON input, chooses the matching lender adapter, fills the lender calculator, extracts the result, and returns structured JSON with screenshot evidence.

Use this document first when opening a fresh conversation. It captures the project shape and the implementation lessons from the recent HSBC, Santander, and Nationwide work.

## Quick Commands

```powershell
npm install
npm.cmd run build
node dist\cli.js .\samples\nationwide\04-remortgage-capital-raising-limited-company-part-and-part.json
node dist\cli.js .\samples\santander\01-purchase-employed-standard.json
node dist\cli.js .\samples\hsbc\01-purchase-employed-standard.json
```

Useful checks:

```powershell
npm.cmd run check
npm.cmd run samples
```

`npm run samples` currently scans only JSON files directly inside `samples/`; lender subfolders such as `samples\nationwide\*.json` need to be run directly unless the runner is extended.

## Main Files

```text
src/cli.ts                         CLI entrypoint. Reads JSON input and prints AffordabilityResult.
src/service.ts                     Validates input, finds adapter, runs automation, captures failures.
src/server.ts                      Express API wrapper.
src/config.ts                      Runtime config, timeouts, browser mode, screenshot directory.

src/domain/contracts.ts            Core input/output TypeScript contracts.
src/domain/validation.ts           Zod validation for lender-ready JSON.

src/adapters/types.ts              LenderAdapter interface.
src/adapters/registry.ts           Registers all supported lenders.
src/adapters/shared/browser.ts     Shared Playwright helpers and result text helpers.

src/adapters/<lender>/adapter.ts   Lender-specific browser automation.
src/adapters/<lender>/mapping.ts   Lender-specific option values, URLs, and constants.

samples/<lender>/*.json            Scenario samples for each lender.
artifacts/screenshots/*.png        Failure/success screenshots captured by runs.
docs/*_FIELD_MAP.md                Existing lender field-map notes.
docs/SANTANDER_COMPLETION_ANALYSIS.md Santander stabilization plan and known issue analysis.
```

Supported lenders are currently declared in `src/domain/contracts.ts` and registered in `src/adapters/registry.ts`:

```text
halifax
barclays
natwest
hsbc
santander
nationwide
```

To add another lender, update both places and add `src/adapters/<lender>/adapter.ts`, `src/adapters/<lender>/mapping.ts`, plus samples.

## Input Contract

The CLI expects `LenderReadyInput` from `src/domain/contracts.ts`. The upstream conversion from fact-find/raw customer data is outside this project. This repo assumes the JSON is already lender-ready.

Important branches in the input:

```text
case.mortgagePurpose       purchase | remortgage_no_additional_borrowing | remortgage_capital_raising | further_advance
case.repaymentType         capital_and_interest | interest_only | part_and_part
case.numberOfApplicants    1 | 2
applicants[].employment    employed | self_employed | pension | other
employment.businessType    sole_trader | limited_company | partnership | llp
otherProperties[]          Existing or additional owned properties
outgoings.otherMortgageCommitments[]  Other mortgage commitments
```

## Adapter Pattern

Each adapter should:

1. Start from the lender URL in `mapping.ts`.
2. Fill each calculator step in order.
3. Use lender-specific IDs/names where possible.
4. Wait for each page/step after clicking next.
5. Detect visible validation errors before claiming result extraction failed.
6. Extract result only from the real results section/page.
7. Return `maximumBorrowing: 0` as success only when the lender results page explicitly says zero lending.

Avoid generic whole-page `Yes`/`No` selectors for complex lender forms. Many calculators reuse the same labels dozens of times, and a fallback click can silently select the wrong radio.

Prefer:

```ts
await checkRadioById(page, "AffCalc-q4-MainResidence-0");
await setInputValueById(page, "AffCalc-q400-LatestPeriodSalary", "92000");
```

Use generic helpers only for low-risk fields or as fallback after exact IDs fail.

## Lessons From Recent Debugging

Most failures were not Playwright timing problems. They were field-map problems.

Common failure causes:

```text
Hidden conditional fields are not visible until a prior radio/select is chosen.
Same label appears multiple times for different applicants or sections.
Same employment type uses different fields per lender.
Self-employed subtypes do not share the same income field IDs.
Interest-only/part-and-part creates extra repayment-strategy sections.
Remortgage and further advance create current-balance/existing-mortgage fields.
Repeated mortgage/property cards require index-specific IDs.
Result extraction can falsely pick currency text from non-result pages if not guarded.
```

Nationwide examples that must guide future work:

```text
Main residence:
  Generic "No" for another question accidentally selected main residence = No.
  Fix: use exact q4 radio and avoid page-wide fallback.

LLP / partnership:
  Uses LatestPeriodProfitShare and PreviousPeriodProfitShare.
  Ordinary net-profit fields remain hidden/irrelevant.

Limited company / director:
  Uses salary including dividends fields:
  q400/q410 for applicant 1, q940/q950 for applicant 2.

Pension income:
  Visible "Other income > Pension?" field is monthly pension income.
  Annual retirement income IDs are different and may be hidden.

Interest-only / part-and-part:
  Requires a repayment plan checkbox, such as Sale of other UK property or UK savings.
  When using Sale of other UK property, fill sale value and current mortgage balance.

Existing mortgages:
  Repeated cards use indexed IDs.
  Fill every generated card, not only index 0.
  Do not create second-applicant cards unless there is actual data for them.
```

Santander examples:

```text
Do not report success unless the form is on the real Results section.
Some pages can display a previously requested amount or page text that looks like a result.
Self-employed income fields and remortgage current-balance fields need exact mapping.
Other properties / other mortgages need exact indexed card filling before sample 09/10 can be trusted.
```

HSBC examples:

```text
Fields with similar surrounding labels can resolve to radios instead of text inputs.
Dates and term fields require exact formatting and exact target fields.
Application type and required selects must be validated on screenshot before changing code.
```

## New Lender Workflow

Before writing adapter code, create a field map. This is the most important step.

Recommended artifact:

```text
docs/<LENDER>_FIELD_MAP.md

Step
Question text
Field ID/name
Input source path
Option values
Conditional trigger
Visible/hidden behavior
Sample case coverage
Known validation messages
```

Inspection checklist:

```text
Application type options
Repayment type options
Single and joint applicant flows
Purchase/remortgage/further advance differences
Property fields and region/Scotland fields
Term fields
Current balance fields
All employment types
All self-employed subtypes
Pension/retired income
Other income
Outgoings
Other mortgages and other properties
Interest-only repayment strategy
Results page layout and text
Validation error container text
```

Implementation checklist:

```text
Add lender to LenderId in src/domain/contracts.ts.
Create mapping.ts with URL and option values.
Create adapter.ts using exact selectors where possible.
Register adapter in src/adapters/registry.ts.
Add at least 10 lender samples under samples/<lender>/.
Run build.
Run each sample directly.
Inspect screenshots for every failure before coding.
Never hide a lender validation issue by loosening result extraction.
```

## Test Case Generation Strategy

Create 10 samples per lender. Each sample should intentionally exercise different branches, not just random data.

Recommended base set:

```text
01 purchase single employed standard
02 purchase joint employed + self-employed with dependants
03 remortgage no additional borrowing pension / retired
04 remortgage capital raising limited company / director part-and-part
05 further advance contractor heavy outgoings
06 purchase shared ownership sole trader
07 purchase Scotland leasehold partnership or LLP with other income
08 remortgage other employment or benefits income
09 purchase joint pension + LLP + other property
10 remortgage multiple mortgages high outgoings
```

For every sample, document the branch intent in the filename and ensure the JSON actually contains the fields needed for that branch. Examples:

```text
limited company/director should include netProfitCurrentYear/netProfitPreviousYear or salary-equivalent values.
part-and-part should include interestOnlyLoanAmount and a repayment strategy source.
remortgage/further advance should include currentBalance or an existing mortgage source where the lender requires it.
other property should include propertyValue, currentBalance, remainingTermYears, rent, and monthlyMortgagePayment.
```

## Debugging Rules

When a sample fails:

1. Open the screenshot from `artifacts/screenshots`.
2. Identify the visible step and validation message.
3. Compare visible fields to the lender field map/schema.
4. Patch the smallest exact field mapping first.
5. Re-run the exact sample.
6. If it advances and fails later, treat that as a new blocker.

Do not guess from the JSON output alone. `result_extraction` often means the browser is still on a validation page, not that extraction is broken.

## Commands For Common Runs

Run one sample:

```powershell
npm.cmd run build
node dist\cli.js .\samples\nationwide\09-purchase-joint-pension-llp-other-property.json
```

Run selected samples:

```powershell
node dist\cli.js .\samples\nationwide\04-remortgage-capital-raising-limited-company-part-and-part.json
node dist\cli.js .\samples\nationwide\09-purchase-joint-pension-llp-other-property.json
node dist\cli.js .\samples\nationwide\10-remortgage-multiple-mortgages-high-outgoings.json
```

Start attached browser mode when a lender rejects fresh automation:

```powershell
npm run attached:browser
```

Then set:

```powershell
$env:BROWSER_EXECUTION_MODE="attached"
$env:BROWSER_WS_ENDPOINT="ws://127.0.0.1:9222/devtools/browser/..."
$env:HEADLESS="false"
node dist\cli.js .\samples\halifax-input.json
```

## Current Caveats

```text
dist/ is generated output from TypeScript build.
artifacts/screenshots/ and tmp/ are runtime artifacts.
node_modules/ is local dependency output.
Some lender sample subfolders are not covered by scripts/run-samples.mjs yet.
Some older docs mention Halifax/Barclays as early slices; registry now contains more lenders.
```
