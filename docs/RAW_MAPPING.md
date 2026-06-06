# Raw Fact-Find Mapping

This document describes the generated raw-to-lender-ready mapping layer.

## Purpose

The automation adapters still run on `LenderReadyInput`. The raw mapping layer converts fact-find style YAML/JSON into that shared contract for all registered lenders:

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

The mapped output is validated with `lenderReadyInputSchema` before being written.

## Files

```text
src/map-barclays.ts                  Single-file Barclays mapper CLI.
src/map-halifax.ts                   Single-file Halifax mapper CLI.
src/map-hsbc.ts                      Single-file HSBC mapper CLI.
src/map-kensington.ts                Single-file Kensington mapper CLI.
src/map-natwest.ts                   Single-file NatWest mapper CLI.
src/map-nationwide.ts                Single-file Nationwide mapper CLI.
src/map-santander.ts                 Single-file Santander mapper CLI.
src/map-skipton.ts                   Single-file Skipton mapper CLI.
src/map-virgin-money.ts              Single-file Virgin Money mapper CLI.

src/mappers/<lender>/raw-to-lender-ready.ts
                                      Reusable raw mapping logic.

scripts/map-<lender>-raw-cases.mjs   Batch mapper for raw case folders.
Mapping_xlxs/*.xlsx                  Workbook mapping references.
```

## Commands

Map the default `input.yaml` into one lender-ready output:

```powershell
npm.cmd run map:halifax
npm.cmd run map:barclays
npm.cmd run map:hsbc
npm.cmd run map:kensington
npm.cmd run map:natwest
npm.cmd run map:nationwide
npm.cmd run map:santander
npm.cmd run map:skipton
npm.cmd run map:virgin-money
```

Map the base raw case folder:

```powershell
npm.cmd run map:halifax:cases
npm.cmd run map:barclays:cases
npm.cmd run map:hsbc:cases
npm.cmd run map:kensington:cases
npm.cmd run map:natwest:cases
npm.cmd run map:nationwide:cases
npm.cmd run map:santander:cases
npm.cmd run map:skipton:cases
npm.cmd run map:virgin-money:cases
```

Map a custom raw folder after building:

```powershell
npm.cmd run build
node scripts\map-halifax-raw-cases.mjs samples\raw-additional-cases samples\halifax-additional-mapped-cases
```

Use the equivalent script for Barclays, HSBC, Skipton, or Virgin Money.

## Sample Folders

Raw inputs:

```text
samples/raw-halifax-cases       10 YAML base cases
samples/raw-additional-cases    20 YAML additional cases
samples/test-cases              48 YAML production cases used by the web/API interface
```

Generated lender-ready outputs:

```text
samples/halifax-mapped-cases
samples/barclays-mapped-cases
samples/hsbc-mapped-cases
samples/kensington-mapped-cases
samples/natwest-mapped-cases
samples/nationwide-mapped-cases
samples/santander-mapped-cases
samples/skipton-mapped-cases
samples/virgin-money-mapped-cases

samples/halifax-additional-mapped-cases
samples/barclays-additional-mapped-cases
samples/hsbc-additional-mapped-cases
samples/skipton-additional-mapped-cases
samples/virgin-money-additional-mapped-cases
```

## Mapping Notes

Mapper output may include `issues`. These are warnings about defaults or ambiguous raw fields, not necessarily fatal errors. Treat them as review items before trusting a case for production regression.

The mapped output should be checked in only when it is useful as a regression fixture. If a raw mapping rule changes, regenerate the affected mapped folders and review the diff.

The web interface currently lists raw cases from `samples/test-cases`. It maps each selected case to all nine lenders in memory, instead of reading the checked-in generated mapped JSON files.
