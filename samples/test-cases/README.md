# Production Raw Test Cases

This folder contains the raw fact-find style YAML cases used by the web/API interface.

The server reads these files from `samples/test-cases`, derives a normalized `caseId` from each filename, and maps the selected raw case to each lender in memory before running affordability.

## Current Use

```text
GET  /api/cases
GET  /api/cases/:caseId
GET  /api/cases/:caseId/input
POST /api/cases/:caseId/run-affordability
```

The run endpoint maps each raw case to all nine mapped lenders:

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

## Coverage

The folder includes:

```text
10 base halifax-raw-case-* scenarios
38 additional-raw-case-* scenarios
48 YAML cases total
```

The additional cases extend coverage for:

```text
contractor and umbrella income
short employment and short trading history
limited company, LLP, partnership, and sole-trader income
pension, benefits, maintenance, and investment income
shared ownership and shared equity
remortgage paydown, capital raising, and further advance
interest-only and part-and-part repayment vehicles
BTL surplus/shortfall and other residential commitments
Wales, Scotland, Northern Ireland, commonhold, and leasehold cases
missing/defaulted fields and edge-case deposit handling
large dependant counts and non-spouse joint applicants
```

## Mapping Commands

The checked-in mapped sample folders can be regenerated from raw folders with lender-specific scripts. For example:

```powershell
npm.cmd run build
node scripts\map-halifax-raw-cases.mjs samples\test-cases samples\halifax-mapped-cases
node scripts\map-santander-raw-cases.mjs samples\test-cases samples\santander-mapped-cases
```

Use the equivalent `scripts\map-<lender>-raw-cases.mjs` script for the other mapped lenders.

## Notes

Keep filenames stable when possible. The UI, run state, and raw input lookup use filename-derived case IDs.

If a raw field is intentionally omitted to test default behavior, document that in the YAML comments or in `TEST_CASE_GAP_ANALYSIS.md`.
