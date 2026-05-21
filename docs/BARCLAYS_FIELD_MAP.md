# Barclays Adapter Field Map

## Calculator URL

`https://onlinemortgages.uk.barclays/secure/launch/residential-affordability-calculator`

## Implemented Scope

The Barclays adapter covers the public four-step residential affordability calculator:

- Step 1: client mortgage requirements
- Step 2: income and commitments
- Step 3: other mortgages, no/summary path
- Step 4: result extraction

## Mapped Fields

| Barclays field | Automation input |
| --- | --- |
| Estimated property price or value | `loan.propertyValue` |
| Total mortgage amount | `loan.loanAmount` |
| Is this property in Scotland? | `property.isInScotland` |
| Split this mortgage into multiple parts? | Fixed to `No` for this slice |
| Do you know the recommended rate? | Fixed to `No` for this slice |
| Mortgage term years/months | `case.termYears`, months fixed to `0` |
| Repayment method | `case.repaymentType` |
| Single or joint application | `case.numberOfApplicants` |
| Main employment status | `applicants[].employment.type` and `isContractor` |
| Annualised contractor income | `applicants[].employment.annualGrossIncome` |
| Employed annual income | `applicants[].employment.annualGrossIncome` |
| Self-employed latest / previous income | `netProfitCurrentYear`, `netProfitPreviousYear` |
| Annual pension income | `annualPensionIncome` |
| Other annual income | sum of `otherIncome[]` and `otherAnnualPensionIncome` |
| Credit card, store card and overdraft balances | `creditCardBalances + overdraftBalances` |
| Other monthly financial commitments | `otherMonthlyOutgoings + monthlyLoanRepayments` |
| Number of financial dependants | `household.dependants.length` |
| Equity loan | `case.sharedOwnershipOrEquity` |
| Other mortgages | `otherProperties[]` and `outgoings.otherMortgageCommitments[]` |

## Verification

Verified against `samples/barclays-input.json` in managed Chromium:

```json
{
  "lender": "barclays",
  "status": "success",
  "maximumBorrowing": 285000
}
```

## Notes

- Barclays uses a stepper UI and custom radio controls.
- The public calculator differs materially from Halifax, so Barclays has its own adapter rather than sharing field-level automation.
- Barclays can render blank steps if the React app is not fully ready; the adapter includes page-open and step-readiness retries.
- The Step 3 yes path is implemented as a summary fill for available other-mortgage fields. A Barclays-specific edge-case matrix should be added before scaling this lender to every possible intermediary scenario.
