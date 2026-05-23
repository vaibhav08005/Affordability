# Barclays Raw Input Mapping

## Purpose

This layer converts the raw fact-find YAML/JSON input into Barclays lender-ready JSON for the existing Barclays calculator adapter.

The flow is:

`raw user input YAML/JSON -> Barclays mapper -> lender-ready Barclays JSON -> Barclays browser automation`

## Files

- `src/mappers/barclays/raw-to-lender-ready.ts`: Barclays conversion rules.
- `src/map-barclays.ts`: CLI for converting one raw input file.
- `scripts/map-barclays-raw-cases.mjs`: batch mapper for the 10 raw sample cases.
- `samples/barclays-mapped-from-input.json`: generated output from `input.yaml`.
- `samples/barclays-mapped-cases`: generated outputs from the raw sample cases.

## Run

Map the provided `input.yaml`:

```powershell
npm.cmd run map:barclays
```

Map all 10 raw cases:

```powershell
npm.cmd run map:barclays:cases
```

## Implemented Rules From The Workbook

| Barclays question area | Implemented rule |
| --- | --- |
| Estimated property price or value | Property value, or share value for shared ownership when supplied. |
| Total mortgage amount | Purchase = property value minus deposit and scheme loan. Remortgage = current balance minus paydown plus additional borrowing. Further advance = additional borrowing amount. |
| Scotland | Derived from property postcode prefixes. |
| Split into multiple parts | Raw `part_and_part` is preserved in JSON, but the current adapter does not yet automate the split-parts UI. |
| Mortgage term | Converts raw term months into years. |
| Single/joint | Uses `var_no_of_applicants`. |
| Employment status | Employed, self-employed, fixed-term contractor, and pension/non-employed are normalized from raw fields. |
| Contractor income | Day rate uses Barclays rule: `day rate * 87% * 230`. |
| Employed income | Salary plus annualized additional hours, allowances, other allowance, and nursing bank. |
| Bonus/overtime/commission | Annualized using Barclays workbook multipliers. |
| Self-employed income | Sole trader, partnership, LLP, limited-company director, and landlord income are mapped to latest/previous annual income. |
| Pension income | Monthly pension multiplied by 12. |
| Other annual income | Benefits, maintenance, and state income are annualized. |
| Credit card/store card/overdraft | Outstanding balances are summed. |
| Other monthly commitments | Loan-style monthly payments, council tax, ground rent, service charge, childcare, education, maintenance paid, shared-ownership rent, and BTL shortfall. |
| Financial dependants | Same dependant adjustment as Halifax for spouse/partner cases. |
| Equity loan | Only Help to Buy / shared equity / armed forces style schemes map to Barclays equity-loan question. |
| Other mortgages | BTL/permission-to-let properties stay in `otherProperties`; residential mortgages map to `outgoings.otherMortgageCommitments`. |

## Known Adapter Limitation

The Barclays workbook includes split mortgage parts for part-and-part cases. The current Barclays browser adapter still answers the public calculator's split-parts question as `No`, and `part_and_part` is mapped to the repayment path by the adapter. The mapper emits a warning for this so it is visible during case generation.
