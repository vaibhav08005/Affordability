# Project Handoff

This project automates UK mortgage intermediary affordability calculators with Playwright. It accepts lender-ready JSON input, and for selected workbook lenders it can also map raw fact-find style YAML/JSON into lender-ready JSON before automation. The service chooses the matching lender adapter, fills the lender calculator, extracts the result, and returns structured JSON with screenshot/PDF evidence.

Use this document first when opening a fresh conversation. It captures the current project shape, the supported lenders, the validation status, and the implementation lessons from the adapter expansion work.

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
npm.cmd test
npm.cmd run samples
```

Current verification status:

```text
npm.cmd run check passes.
All 312 sample JSON files currently validate against src/domain/validation.ts.
npm.cmd test currently runs 0 tests because there are no compiled *.test.js files.
npm.cmd run samples still scans only top-level samples/*.json, so it is not a complete regression run.
```

`npm.cmd run samples` currently does not exercise the real lender sample matrix. Most sample files live under lender subfolders such as `samples\nationwide\*.json` and mapped-case folders such as `samples\halifax-mapped-cases\*.json`; run individual samples directly or extend the runner to recurse into subfolders with lender filters.

## Main Files

```text
src/cli.ts                         CLI entrypoint. Reads JSON input and prints AffordabilityResult.
src/service.ts                     Validates input, finds adapter, runs automation, captures failures.
src/server.ts                      Express API wrapper.
src/config.ts                      Runtime config, timeouts, browser mode, screenshot directory.
src/repositories/run-repository.ts In-memory run result repository boundary for web/API results.

src/domain/contracts.ts            Core input/output TypeScript contracts.
src/domain/validation.ts           Zod validation for lender-ready JSON.

src/adapters/types.ts              LenderAdapter interface.
src/adapters/registry.ts           Registers all supported lenders.
src/adapters/shared/browser.ts     Shared Playwright helpers and result text helpers.

src/adapters/<lender>/adapter.ts   Lender-specific browser automation.
src/adapters/<lender>/mapping.ts   Lender-specific option values, URLs, and constants.

src/map-<lender>.ts                CLI mapper entry points for raw fact-find input.
src/mappers/<lender>/raw-to-lender-ready.ts
                                    Raw fact-find to lender-ready mapping logic.
scripts/map-<lender>-raw-cases.mjs Batch mapping scripts for raw case folders.

public/index.html                  Static browser interface served by src/server.ts.
samples/<lender>/*.json            Hand-authored scenario samples for each lender.
samples/raw-halifax-cases/*.yaml   Base raw fact-find case set.
samples/raw-additional-cases/*.yaml Additional raw fact-find case set.
samples/*-mapped-cases/*.json      Generated lender-ready outputs from raw cases.
artifacts/screenshots/*.png        Failure/success screenshots captured by runs.
Mapping_xlxs/*.xlsx                Workbook mapping references for mapped lenders.
docs/*_FIELD_MAP.md                Existing lender field-map notes.
docs/*_RAW_MAPPING.md              Raw fact-find mapping notes where available.
docs/RAW_MAPPING.md                Cross-lender raw mapping workflow.
docs/SANTANDER_COMPLETION_ANALYSIS.md Santander stabilization plan and known issue analysis.
Dockerfile                         Playwright runtime image for server deployment.
```

Supported lenders are currently declared in `src/domain/contracts.ts` and registered in `src/adapters/registry.ts`:

```text
barclays
halifax
hsbc
kensington
natwest
santander
nationwide
skipton
virgin_money
```

To add another lender, update both places and add `src/adapters/<lender>/adapter.ts`, `src/adapters/<lender>/mapping.ts`, plus samples.

Current sample counts by folder:

```text
barclays                              12
barclays-mapped-cases                 10
barclays-additional-mapped-cases      20
halifax                               14
halifax-mapped-cases                  31
halifax-additional-mapped-cases       20
hsbc                                  10
hsbc-mapped-cases                     10
hsbc-additional-mapped-cases          20
kensington                            20
nationwide                            10
natwest                               12
santander                             21
skipton                               20
skipton-mapped-cases                  10
skipton-additional-mapped-cases       20
virgin-money                          20
virgin-money-mapped-cases             10
virgin-money-additional-mapped-cases  20
raw-halifax-cases                     10 YAML
raw-additional-cases                  20 YAML
```

## Input Contract

The automation CLI expects `LenderReadyInput` from `src/domain/contracts.ts`. The raw fact-find mapping layer now exists for five mapped workbook lenders:

```text
barclays
halifax
hsbc
skipton
virgin_money
```

These mappers accept raw YAML/JSON and return validated lender-ready JSON. The other registered adapters still expect lender-ready input directly.

Important branches in the input:

```text
case.mortgagePurpose       purchase | remortgage_no_additional_borrowing | remortgage_capital_raising | further_advance
case.repaymentType         capital_and_interest | interest_only | part_and_part
case.numberOfApplicants    1 | 2
applicants[].employment    employed | self_employed | pension | other
employment.businessType    sole_trader | limited_company | partnership | llp
otherProperties[]          Existing or additional owned properties
outgoings.otherMortgageCommitments[]  Other mortgage commitments
case.sharedEquityCustomerStakePercent Optional shared equity customer stake
case.monthlySharedEquityInterestPayment Optional shared equity monthly interest
case.equityLoanBalance / equityLoanInterestRatePercent Optional equity loan details
evidence.screenshotPaths[] Optional multi-screenshot evidence
evidence.pdfPath           Optional PDF evidence path
```

## Raw Mapping Workflow

Single-input mapper commands read `input.yaml` by default and write one lender-ready JSON output:

```powershell
npm.cmd run map:halifax
npm.cmd run map:barclays
npm.cmd run map:hsbc
npm.cmd run map:skipton
npm.cmd run map:virgin-money
```

Batch mapper commands build first, then read raw case files and write mapped output folders:

```powershell
npm.cmd run map:halifax:cases
npm.cmd run map:barclays:cases
npm.cmd run map:hsbc:cases
npm.cmd run map:skipton:cases
npm.cmd run map:virgin-money:cases
```

Default batch input/output behavior:

```text
map:halifax:cases       samples/raw-halifax-cases -> samples/halifax-mapped-cases
map:barclays:cases      samples/raw-halifax-cases -> samples/barclays-mapped-cases
map:hsbc:cases          samples/raw-halifax-cases -> samples/hsbc-mapped-cases
map:skipton:cases       samples/raw-halifax-cases -> samples/skipton-mapped-cases
map:virgin-money:cases  samples/raw-halifax-cases -> samples/virgin-money-mapped-cases
```

The batch scripts also accept optional input and output directory arguments after build, for example:

```powershell
npm.cmd run build
node scripts\map-halifax-raw-cases.mjs samples\raw-additional-cases samples\halifax-additional-mapped-cases
```

Mapper outputs are parsed through `lenderReadyInputSchema` before being written. If a mapper emits `issues`, treat those as mapping warnings that need field-map review.

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
The current adapter also mutates Santander Vue/Pinia internal state for details/income stabilization.
Treat that as a pragmatic but fragile integration point; prefer visible field filling where possible.
```

HSBC examples:

```text
Fields with similar surrounding labels can resolve to radios instead of text inputs.
Dates and term fields require exact formatting and exact target fields.
Application type and required selects must be validated on screenshot before changing code.
```

Kensington examples:

```text
Product selection is part of the calculator state, not just decoration.
The adapter chooses a product range and product before entering property and income data.
The calculator can return a backend webcalculator response; visible RESIDENTIAL RESULTS still gates success.
```

Skipton and Virgin Money examples:

```text
These adapters rely heavily on stable IDs and focused result-page checks.
Keep extraction tied to explicit result text, not arbitrary currency values on the page.
Virgin Money zero lending is valid only when the explicit cannot-help results page is returned.
```

## Current Reliability Priorities

The architecture is sound, but reliability now depends on regression coverage and exact lender field mapping.

Recommended next work:

```text
1. Extend scripts/run-samples.mjs to recursively run samples/<lender>/*.json and support a lender filter.
2. Add validation-only tests for every sample JSON file and mapped-case output folder.
3. Add unit tests for shared extraction helpers and lender-specific result parsing where possible.
4. Consolidate duplicated browser/session/evidence/error helpers into src/adapters/shared/browser.ts.
5. Mark adapter confidence levels in docs: production-ish, experimental, needs field-map pass.
6. Tighten domain validation for branch-specific requirements such as interest-only amounts, remortgage current balance, and applicant count/application type consistency.
7. Revisit Santander store mutation and replace it with visible-field automation where practical.
8. Add raw-mapping docs for HSBC, Skipton, and Virgin Money to match the existing Halifax/Barclays raw mapping notes.
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

Run a generated mapped sample:

```powershell
npm.cmd run build
node dist\cli.js .\samples\halifax-mapped-cases\halifax-raw-case-01-ftb-single-employed.json
```

Start the local web interface:

```powershell
npm.cmd run api
```

Open:

```text
http://localhost:3000
```

Start attached browser mode when a lender rejects fresh automation:

```powershell
npm.cmd run attached:browser
```

Then set:

```powershell
$env:BROWSER_EXECUTION_MODE="attached"
$env:BROWSER_WS_ENDPOINT="ws://127.0.0.1:9222/devtools/browser/..."
$env:HEADLESS="false"
node dist\cli.js .\samples\halifax\test-case-1.json
```

## Current Caveats

```text
dist/ is generated output from TypeScript build.
artifacts/screenshots/ and tmp/ are runtime artifacts.
node_modules/ is local dependency output.
scripts/run-samples.mjs does not recurse into lender sample folders yet.
npm.cmd test currently runs zero tests.
Some older field-map docs were written during early lender slices; verify against source before relying on them.
Santander has a complex adapter with Vue/Pinia internal state writes; treat it as higher maintenance risk.
The web/API process now serves the static UI and case routes, but results are still in memory only.
The API has no auth, no queue, no durable persistence, no retention policy, and no GET /runs/:id yet.
```
