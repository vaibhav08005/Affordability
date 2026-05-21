# Virgin Money Field Map

Calculator URL: `https://intermediaries.virginmoney.com/affordability-calculator/residential/loan-details/`

Inspection date: 2026-05-14

Virgin Money is a multi-page MVC form:

1. `/loan-details/`
2. `/personal-details/`
3. `/outgoings/`
4. `/results/`

## Loan Details

| Question text | Field ID/name | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- |
| Loan type | `purchase`, `remortgage`; name `Form.LoanDetails.LoanType` | `case.mortgagePurpose` | Remortgage hides shared ownership and shows current balance/additional borrowing | 01, 03, 04, 05, 08, 10 |
| Shared ownership? | `hbs-yes-shared-ownership`, `hbs-no-shared-ownership`; name `Form.LoanDetails.HomeBuyingScheme` | `case.sharedOwnershipOrEquity` | Purchase only; Yes can reveal `Form_LoanDetails_SharePercentage` | 06 |
| Repayment type | `capital-and-interest`, `interest-only`, `part-and-part`; name `Form.LoanDetails.RepaymentType` | `case.repaymentType` | Part-and-part shows split loan amount fields | 01, 03, 04 |
| Mortgage term | `Form_LoanDetails_RepaymentTerm` | `case.termYears` | Must be 5-40 years | All |
| Product fixed for 5 years or longer | `yes_pfto`, `no_pfto`; name `Form.LoanDetails.IsProductFixedTerm` | Adapter default Yes | None | All |
| Initial product interest rate | `Form_LoanDetails_ProductInterestRate` | Adapter default `5.2` | None | All |
| Purchase price | `Form_LoanDetails_PurchasePrice` | `loan.propertyValue` | Purchase only | 01, 02, 06, 07, 09 |
| Estimated property value | `Form_LoanDetails_PropertyValue` | `loan.propertyValue` | Remortgage only | 03, 04, 05, 08, 10 |
| Mortgage amount | `Form_LoanDetails_MortgageLoanAmount` | `loan.loanAmount` | Purchase capital-and-interest / interest-only | 01, 02, 03 |
| Current mortgage balance | `Form_LoanDetails_CurrentMortgageBalance` | `loan.currentBalance ?? loan.loanAmount` | Remortgage only | 03, 04, 05, 08, 10 |
| Additional borrowing amount | `Form_LoanDetails_AdditionalBorrowingAmount` | `loan.loanAmount - loan.currentBalance` for capital raising/further advance; zero for no additional borrowing | Remortgage only | 03, 04, 05, 10 |
| Requested capital and interest amount | `Form_LoanDetails_CILoanAmount` | `loan.loanAmount - case.interestOnlyLoanAmount` | Part-and-part only | 04 |
| Requested interest only amount | `Form_LoanDetails_IOLoanAmount` | `case.interestOnlyLoanAmount` | Part-and-part only | 04 |
| Percentage share on completion | `Form_LoanDetails_SharePercentage` | Adapter default `50` | Shared ownership only | 06 |

## Personal Details And Income

| Question text | Field ID/name | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- |
| Application type | `single-application`, `joint-application`; name `Form.FirstPersonalDetails.NumberOfApplicants` | `case.numberOfApplicants` | Joint reveals second customer block | 01, 02, 09 |
| Number of financial dependants | `Form_FirstPersonalDetails_Dependants` | `household.dependants.length` | None | 02, 05, 07, 09 |
| First customer age | `Form_FirstPersonalDetails_Age` | `applicants[0].age` | None | All |
| Second customer age | `Form_SecondPersonalDetails_Age` | `applicants[1].age` | Joint only | 02, 09 |
| Country of main residency | `england-1-1`, `northern-ireland-1-1`, `scotland-1-1`, `wales-1-1`; name `Form.FirstPersonalDetails.CustomerLocation` | `property.isInScotland` | First customer location; adapter uses Scotland when true | 07 |
| Main income type | `Form_FirstPersonalDetails_Employment1_EmploymentStatus`, `Form_SecondPersonalDetails_Employment1_EmploymentStatus` | `applicants[].employment.type`; contractors use `Contractor`; pension uses `Retired`; other uses `Not Employed` | Reveals income fields by employment type | 01-10 |
| Employed gross salary | `Form_<prefix>_Employment1_EmployedGrossAnnualSalary` | `employment.annualGrossIncome` | Employment status `Employed` | 01, 02 |
| Overtime, bonus and commission | `Form_<prefix>_Employment1_OvertimeBonusCommission` | `annualOvertime + annualBonus + annualCommission` | Employment status `Employed` | 08 |
| Most recent net profit | `Form_<prefix>_Employment1_MostRecentNetProfit` | `employment.netProfitCurrentYear` | Employment status `Self-employed`; covers sole trader, partnership, LLP, limited company at public-form level | 02, 04, 06, 07, 09 |
| Previous year net profit | `Form_<prefix>_Employment1_PreviousYearNetProfit` | `employment.netProfitPreviousYear` | Employment status `Self-employed` | 02, 04, 06, 07, 09 |
| Pension income | `Form_<prefix>_Employment1_GrossAnnualPensionIncome` | `annualPensionIncome + otherAnnualPensionIncome` | Employment status `Retired` | 03, 09 |
| Contractor gross annual income | `Form_<prefix>_Employment1_ContractorGrossAnnualIncome` | `employment.annualGrossIncome` | Employment status `Contractor` | 05 |
| Benefits and financial support | `Form_<prefix>_Employment1_BenefitsOtherIncome` | `otherIncome[]` or `annualGrossIncome` for `employment.type=other` | Employment status `Not Employed` | 08 |
| Second income yes/no | `yes-employment-1-1`, `no-employment-1-1`, `yes-employment-2-1`, `no-employment-2-1` | Derived from `otherIncome[]` | Yes reveals `Employment2` fields | 07, 09 |
| Second income type | `Form_<prefix>_Employment2_EmploymentStatus` | Adapter uses `Not Employed` for generic second income | Second income = Yes | 07, 09 |
| Second income benefits/support | `Form_<prefix>_Employment2_BenefitsOtherIncome` | `otherIncome[]` annual total | Second income = Yes and type `Not Employed` | 07, 09 |

## Outgoings

| Question text | Field ID/name | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- |
| Expenditure mode | `total-monthly-expenditure`, `detailed-financial-expenditure` | Adapter uses total monthly figure | None | All |
| Total monthly household expenditure | `Form_Outgoings_MonthlyHouseholdExpenditure` | `outgoings.otherMonthlyOutgoings` | Total monthly figure mode | All |
| Monthly ground rent | `Form_Outgoings_MonthlyGroundRent` | Adapter default 0 | None | 07 field noted |
| Monthly service charge | `Form_Outgoings_MonthlyServiceCharge` | Adapter default 0 | None | 06/07 field noted |
| Monthly childcare and education | `Form_Outgoings_MonthlyChildcareEducation` | Adapter default 0 | None | 02 dependent branch noted |
| Monthly maintenance/child support | `Form_Outgoings_MonthlyMaintenanceCSA` | Adapter default 0 | None | 07 field noted |
| Other residential properties | `YesOtherResi`, `NoOtherResi` | `otherProperties.length > 0 || otherMortgageCommitments.length > 0` | Yes caps LTV and may reveal extra details in future work | 09, 10 |
| Other buy-to-let mortgages | `YesOtherBTL`, `NoOtherBTL` | `outgoings.monthlyBuyToLetPayments > 0` | None observed beyond yes/no | 09 |
| Current credit card balances | `Form_Outgoings_OutstandingCredit` | `creditCardBalances + overdraftBalances` | None | 01, 10 |
| Credit outstanding after completion | `Form_Outgoings_OutstandingCreditCompletion` | Same as current credit balance | None | 01, 10 |
| Current loan repayments per month | `Form_Outgoings_CurrentLoanRepayments` | `monthlyLoanRepayments` | None | 01, 05, 10 |
| Repayments after completion | `Form_Outgoings_RepaymentsAfterCompletion` | `monthlyLoanRepayments` | None | 01, 05, 10 |

## Results

The real results URL is `/affordability-calculator/residential/results/`.

Observed result text:

```text
Affordability results
Based on a £300,000 property we could lend:
£285,000
Based on a higher property value we could lend:
£394,000
```

Extraction must verify the `/results/` URL and reject validation pages. The primary value is the amount after `Based on a £... property we could lend:`.

Virgin Money can also return a real results page with:

```text
It looks like we can't help
Because based on what you've told us, we won't be able to lend to your customer
```

That page is treated as an explicit zero-lending result and returned as `maximumBorrowing: 0`.

## Validation Text Observed

```text
There are errors on this page
Please select
field is required
must be
Enter ...
```
