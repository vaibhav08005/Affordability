# Halifax Raw Input Mapping

## Purpose

This layer converts the raw fact-find style input, such as `input.yaml`, into the existing Halifax lender-ready JSON used by the browser automation adapter.

The flow is:

`raw user input YAML/JSON -> Halifax mapper -> lender-ready Halifax JSON -> Halifax browser automation`

The mapper intentionally lives outside `src/adapters/halifax/adapter.ts`. The adapter should only know how to fill the Halifax website. This mapper knows how to interpret business rules from `Halifax mapping.xlsx`.

## Files

- `src/mappers/halifax/raw-to-lender-ready.ts`: conversion rules.
- `src/map-halifax.ts`: CLI for converting raw YAML/JSON to lender-ready JSON.
- `samples/halifax-mapped-from-input.json`: generated output from the provided `input.yaml`.

## Run

```powershell
npm.cmd run map:halifax
```

This reads:

`input.yaml`

and writes:

`samples/halifax-mapped-from-input.json`

You can also run it manually:

```powershell
npx.cmd tsx src/map-halifax.ts input.yaml samples/halifax-mapped-from-input.json
```

## Implemented Rules From The Workbook

| Halifax question area | Implemented rule |
| --- | --- |
| Applicant count | `var_no_of_applicants`; values >= 2 map to Halifax `2+`. |
| Dependants | Applicant dependant arrays are combined. For joint spouse/partner cases, spouse/partner dependants are excluded. |
| Loan type | FTB/home mover/moving home map to purchase. Further advance maps to further advance. Remortgage with additional borrowing maps to capital raising; otherwise remortgage no extra borrowing. |
| Customer type | FTB journey maps to first-time buyer; otherwise home mover. |
| Property value | Uses `var_property_value`, except shared ownership can use share value when supplied. |
| Loan amount | Purchase = property value minus deposit and any scheme loan. Remortgage = current balance minus paydown plus additional borrowing. |
| Loan term | Converts mortgage term in months to years. |
| Shared ownership/equity | Non-standard ownership schemes map to shared scheme fields. |
| Interest-only | Interest-only and part-and-part repayment types enable interest-only fields. |
| Scotland | Property postcode prefixes are mapped according to the workbook rule. |
| Tenure | Freehold/share of freehold map to freehold. Leasehold/commonhold map to leasehold. Scotland defaults to outright ownership unless leasehold/commonhold is present. |
| Employment | Employed, contractor, self-employed, retired/pension, and other employment categories are normalized. |
| Contractor income | Day rate maps to `day rate * 5 * 46`; otherwise salary fallback is used. |
| Bonus | Uses the lower of latest annualized bonus and average of latest plus previous annualized bonus. |
| Overtime/commission | Annualized from their frequency fields. |
| Self-employed | Sole trader, limited company, partnership, and LLP income rules are mapped into current/previous profit fields. |
| Pension | Monthly pension maps to annual pension. |
| Other income | Benefits, maintenance, rental income, allowances, nursing bank, and additional hours are annualized and mapped to Halifax income types. |
| Credit cards | Included affordability credit-card commitments map to total outstanding credit card balances. |
| Overdrafts | Included overdraft commitments map to total outstanding overdraft balances. |
| Loan repayments | Included loan-style commitments, committed expenditure, and BTL/CTL shortfalls map to monthly loan repayments. |
| Other monthly outgoings | Childcare, nursery/school fees, and maintenance payments are summed. |
| Residential mortgage commitments | Mortgaged non-BTL properties map to other mortgage commitments with outstanding balance and remaining term. |

## Default Rules

Some required Halifax calculator fields are missing from the provided sample. The mapper records issues and applies safe defaults:

- Missing applicant date of birth -> age `35`.
- Missing property postcode -> `property.isInScotland = false`.
- Missing EPC -> `unknown`.
- Missing tenure -> `freehold`, or `outright_or_absolute_ownership` for Scotland.

These defaults are visible through the CLI's `mappingIssues` output.

## Not Yet Represented In The Current Lender-Ready Contract

The workbook includes some Halifax calculator fields that the current browser adapter/schema does not yet carry:

- Leasehold ground rent/service charge known.
- Annual ground rent.
- Annual service charge.
- Non-sterling income flag.
- Shared equity stake held by customer.
- Shared equity monthly interest payment.
- Static result messaging based on rate type and initial period.

Those should be added by extending `LenderReadyInput`, validation, and `src/adapters/halifax/adapter.ts` if we need the browser automation to fill them on the live calculator.
