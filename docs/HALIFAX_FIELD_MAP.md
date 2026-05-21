# Halifax Adapter Field Map

## Calculator URL

Use the direct calculator page:

`https://www2.halifax-intermediariesonline.co.uk/tools/calculator/`

## Scope

This adapter accepts lender-ready JSON. Raw fact-find conversion remains upstream.

## Questions And Options

| Halifax question | Options / fields | Automation input |
| --- | --- | --- |
| How many people are applying? | `1`, `2+` | `case.numberOfApplicants` |
| Applicant age | Numeric age for single applicant | `applicants[0].age` |
| Applicant 1 age / Applicant 2 age | Numeric ages for joint case | `applicants[].age` |
| How many child or adult dependants? | `0`, `1`, `2`, `3+` | `household.dependants.length` |
| Loan type | Purchase; Remortgage with no additional borrowing; Remortgage with capital raising; Further advance | `case.mortgagePurpose` |
| Who is the customer? | First-time buyer; Home mover | `case.customerType` |
| Property purchase price | Currency | `loan.propertyValue` |
| Loan amount | Currency | `loan.loanAmount` |
| Loan term (years) | Number | `case.termYears` |
| Shared ownership / shared equity? | Yes; No | `case.sharedOwnershipOrEquity` |
| Scheme type | Shared ownership; Shared equity | `case.sharedOwnershipScheme` |
| Monthly rent payable | Currency, shown for shared scheme | `case.monthlySharedOwnershipRent` |
| Interest-only? | Yes; No | `case.hasInterestOnly` |
| Interest-only loan amount | Currency, shown for interest-only | `case.interestOnlyLoanAmount` |
| Monthly premium for repayment plans | Currency, shown for interest-only | `case.monthlyRepaymentPlanPremium` |
| Is the property in Scotland? | Yes; No | `property.isInScotland` |
| Property type, non-Scotland | Freehold; Leasehold | `property.tenure` |
| Property type, Scotland | Outright or absolute ownership; Leasehold | `property.tenure` |
| Property EPC rating | Unknown; A; B; C; D; E; F; G; Exempt | `property.epcRating` |

## Income

Halifax lets each applicant select multiple income type checkboxes. The adapter fills every income component present in lender-ready JSON.

| Halifax field | Options / fields | Automation input |
| --- | --- | --- |
| Income from employer(s) | Checkbox | Present when employed fields are supplied |
| Are they a contractor? | Yes; No | `applicants[].employment.isContractor` |
| Gross annual basic salary | Currency | `applicants[].employment.annualGrossIncome` |
| Annual overtime | Currency | `applicants[].employment.annualOvertime` |
| Annual bonus payments | Currency | `applicants[].employment.annualBonus` |
| Annual commission | Currency | `applicants[].employment.annualCommission` |
| Self employed | Checkbox | Present when self-employed fields are supplied |
| Self employment type | Sole trader; Limited company; Partnership; LLP | `applicants[].employment.businessType` |
| Net profit (current year) | Currency | `applicants[].employment.netProfitCurrentYear` |
| Net profit (previous year) | Currency | `applicants[].employment.netProfitPreviousYear` |
| Pension | Checkbox | Present when pension fields are supplied |
| Taxable annual pension income | Currency | `applicants[].employment.annualPensionIncome` |
| Other annual pension income | Currency | `applicants[].employment.otherAnnualPensionIncome` |
| Other income | Checkbox, repeatable rows | `applicants[].otherIncome[]` |

## Other Income Options

`applicants[].otherIncome[].type` maps to:

- `additional_duty_hours`: Additional duty hours
- `attendance_allowance`: Attendance allowance
- `carers_allowance`: Carer's allowance
- `child_benefit`: Child benefit
- `child_tax_credit`: Child tax credit
- `colleague_flexible_benefit`: Colleague flexible benefit
- `constant_attendance_allowance`: Constant attendance allowance
- `disability_living_allowance`: Disability Living Allowance
- `employment_support_allowance`: Employment & Support Allowance
- `flight_pay_allowance`: Flight pay/Allowance
- `income_support`: Income support
- `industrial_injuries_disablement_benefit`: Industrial injuries disablement benefit
- `investment_income`: Investment income
- `maintenance`: Maintenance
- `mortgage_subsidy`: Mortgage subsidy
- `nursing_bank`: Nursing bank
- `personal_independence_payment`: Personal independence payment
- `rental_income_btl`: Rental income (from Buy to Let properties owned)
- `shift_allowance`: Shift allowance
- `town_area_or_car_allowance`: Town, area, or car allowance
- `trust_income`: Trust income
- `universal_credit`: Universal Credit
- `widowed_parents_allowance`: Widowed parents' allowance
- `working_tax_credit`: Working tax credit

## Outgoings

| Halifax question | Options / fields | Automation input |
| --- | --- | --- |
| Monthly loan repayments | Currency | `outgoings.monthlyLoanRepayments` |
| Total outstanding credit card balances | Currency | `outgoings.creditCardBalances` |
| Total outstanding overdraft balances | Currency | `outgoings.overdraftBalances` |
| Total amount of other monthly outgoings | Currency | `outgoings.otherMonthlyOutgoings` |
| Monthly Buy to Let mortgage payments | Currency | `outgoings.monthlyBuyToLetPayments` |
| Other properties owned other than Buy to Lets? | Yes; No | `otherProperties.length > 0` |
| Other mortgage commitments to remain? | Yes; No | `outgoings.otherMortgageCommitments.length > 0` |
| Outstanding balance | Currency, repeatable | `outgoings.otherMortgageCommitments[].outstandingBalance` |
| Remaining term (years) | Number, repeatable | `outgoings.otherMortgageCommitments[].remainingTermYears` |

## Implementation Notes

- Halifax uses custom radio-list markup for loan type, scheme type, self-employment type, and property type.
- Applicant sections repeat for two-applicant cases.
- Other income and mortgage commitments are repeatable.
- Managed Playwright currently receives Halifax's system-problem page in this environment; attached/trusted browser execution is the next runtime workstream.
- Result extraction still needs a successful calculation pass once the runtime can reach the calculator reliably.
