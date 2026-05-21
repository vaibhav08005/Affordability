# Skipton Field Map

Calculator URL: `https://affordability.skipton-intermediaries.co.uk/`

Inspection date: 2026-05-14

Skipton is an ASP.NET WebForms calculator. The public calculator is a four-step flow followed by a results page:

1. Application details
2. About the applicants
3. Income
4. Expenditure
5. Results

The calculator does not expose an explicit purchase/remortgage/further-advance/capital-raising question. All `mortgagePurpose` values currently use the same property price, loan amount, mortgage term, repayment type, region, and expenditure fields. For remortgage-like samples, existing mortgage/current-balance data is represented in expenditure where Skipton exposes only a residential mortgage balance field.

## Application Details

| Question text | Field ID/name | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- |
| Number of applicants | `MainContent_rblNumberOfApplicants_0` = 1, `_1` = 2 | `case.numberOfApplicants` | None | 01, 02, 09 |
| Total number of adult dependants | `MainContent_txtNoOfAdultDependants` | `household.dependants[age >= 18]` | None | 05, 10 |
| Total number of child dependants | `MainContent_txtNoOfChildDependants` | `household.dependants[age < 18]` | None | 02, 07, 09 |
| Property price | `MainContent_txtPurchasePrice` | `loan.propertyValue` | None | All |
| Loan amount | `MainContent_txtLoanAmount` | `loan.loanAmount` | None | All |
| Interest rate of product | `MainContent_txtProductInterestRate` | Adapter default `5.2` | Optional but filled for consistency | All |
| Is the property a new build? | `MainContent_rblNewBuild_0` = Yes, `_1` = No | Adapter default No | None | All |
| Long-term fixed rate mortgage? | `MainContent_rblWillTakeLongTermFixedProduct_0` = Yes, `_1` = No | Adapter default Yes | None | All |
| Repayment type | `MainContent_rblRepaymentType_0` = Repayment, `_1` = Interest Only, `_2` = Part interest and Part Repayment | `case.repaymentType` | Part-and-part reveals interest-only amount | 01, 03, 04 |
| Interest-only amount | `MainContent_txtInterestOnlyAmount` | `case.interestOnlyLoanAmount` | Visible for part-and-part; not visible in inspected interest-only state | 04 |
| Mortgage term | `MainContent_txtTermYears`, `MainContent_txtTermMonths` | `case.termYears`, fixed `0` months | None | All |
| Region of property | `MainContent_ddlRegion` values include `se`, `sc`, `wa`, `ni` | `property.isInScotland` maps to `sc`; otherwise `se` | None | 07 |
| Main residence for all applicants? | `MainContent_rblMainResidence_0` = Yes, `_1` = No | Adapter default Yes | None | All |
| Fee to be added | `MainContent_txtFeeAmount` | Adapter default `0` | None | All |

## About The Applicants

Applicant IDs are repeated by index. Applicant 1 uses index `0`; applicant 2 uses index `1`.

| Question text | Field ID/name | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- |
| First Time Buyer? | `MainContent_rptApplicants_rblFirstTimeBuyer_<i>_0_<i>` = Yes, `_1_` = No | `case.customerType` | Repeated per applicant | 01, 02 |
| Employment status | `MainContent_rptApplicants_rblEmploymentTypes_<i>_0_<i>` = Employed, `_1_` = Other, `_2_` = Retired, `_3_` = Self-employed, `_4_` = Student | `applicants[].employment.type`, contractors map to Other | Repeated per applicant | 01-10 |
| Residential status | `MainContent_rptApplicants_rblresidentialStatus_<i>_0_<i>` = Owner, `_1_` = Tenant, `_2_` = Living with parents, `_3_` = Living with others | `case.customerType`; first-time buyers map to Tenant, others Owner | Repeated per applicant | 01, 02, 03 |

## Income

Applicant 1 income IDs end in `0`; applicant 2 income IDs end in `1`.

| Question text | Field ID/name | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- |
| Annual Basic Income | `MainContent_txtIncome000001<i>` | `employment.annualGrossIncome` for employed/other/student | Employment status Employed, Other, or Student | 01, 02, 05, 08 |
| Annual Pension | `MainContent_txtIncome000012<i>` | `employment.annualPensionIncome + otherAnnualPensionIncome` | Employment status Retired | 03, 09 |
| Net Profit (Sole Trader/Partnership Co) | `MainContent_txtIncome000007<i>` | `employment.netProfitCurrentYear` | Employment status Self-employed, business type sole trader/partnership/LLP | 06, 07, 09 |
| Dividends Received (Ltd Comp Only) | `MainContent_txtIncome000008<i>` | `employment.netProfitCurrentYear` for limited company | Employment status Self-employed, limited company | 04 |
| Directors Remuneration (Ltd Comp Only) | `MainContent_txtIncome000009<i>` | `employment.annualGrossIncome` or current profit fallback | Employment status Self-employed, limited company | 04 |
| Any other income? | `MainContent_rblAdditionalIncome<i>_0` = Yes, `_1` = No | Derived from variable/other/pension/contractor income | Yes reveals extra income fields | 04, 05, 07, 08 |
| Guaranteed Other | `MainContent_txtIncome2<i>` | `employment.annualBonus` plus non-benefit/non-maintenance/non-rental `otherIncome[]`, such as investment income | Additional income = Yes | 01 optional, 03, 08 |
| Non-Guaranteed Other | `MainContent_txtIncome3<i>` | `annualOvertime + annualCommission` | Additional income = Yes | 01 optional, 08 |
| Net Profit additional | `MainContent_txtIncome4<i>` | Currently zero for non self-employed additional panel | Additional income = Yes | Field recorded |
| Dividends additional | `MainContent_txtIncome5<i>` | Currently zero for non self-employed additional panel | Additional income = Yes | Field recorded |
| Directors remuneration additional | `MainContent_txtIncome6<i>` | Currently zero for non self-employed additional panel | Additional income = Yes | Field recorded |
| Benefit | `MainContent_txtIncome7<i>` | Benefit-like `otherIncome[]` annual total | Additional income = Yes | 08 |
| Annual Pension additional | `MainContent_txtIncome8<i>` | Pension annual total for non-retired applicants when the field is visible. Retired applicants use `MainContent_txtIncome000012<i>` as their primary pension field and do not show this additional-pension field. | Additional income = Yes | 09 |
| Maintenance | `MainContent_txtIncome9<i>` | `otherIncome[type=maintenance]` | Additional income = Yes | 07 |
| Rental Profit Minus Finance Costs | `MainContent_txtIncome10<i>` | `otherIncome[type=rental_income_btl]` | Additional income = Yes | 09 |
| Contractor Income | `MainContent_txtIncome11<i>` | `employment.annualGrossIncome` when `isContractor` | Additional income = Yes and contractor mapped as Other | 05 |

## Expenditure

Expenditure IDs repeat by applicant suffix `_0`, `_1`.

| Question text | Field ID/name | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- |
| Maintenance/Child Support | `MainContent_txtExpenditure_000003_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Nursery/Child Care Costs | `MainContent_txtExpenditure_000005_<i>` | Adapter default `0` | Per applicant | 02 dependent branch present |
| Tuition Fees | `MainContent_txtExpenditure_000006_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Credit Cards | `MainContent_txtExpenditure_000023_<i>` | `outgoings.creditCardBalances` | Per applicant; adapter places aggregate on applicant 1 | 01, 10 |
| Store Cards | `MainContent_txtExpenditure_000024_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Personal (Unsecured) Loans | `MainContent_txtExpenditure_000031_<i>` | `outgoings.monthlyLoanRepayments` | Per applicant; adapter places aggregate on applicant 1 | 01, 05, 10 |
| Student Loans | `MainContent_txtExpenditure_000033_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Residential Mortgage Balance | `MainContent_txtExpenditure_000034_<i>` | `loan.currentBalance` or other mortgage/property balances | Per applicant; adapter places aggregate on applicant 1 | 03, 10 |
| Help To Buy - Equity Loan Balance | `MainContent_txtExpenditure_000035_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Service Charge | `MainContent_txtExpenditure_000036_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Shared Ownership - Rent | `MainContent_txtExpenditure_000037_<i>` | `case.monthlySharedOwnershipRent` | Per applicant | 06 |
| Ground Rent | `MainContent_txtExpenditure_000038_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Estate Rentcharge | `MainContent_txtExpenditure_000041_<i>` | Adapter default `0` | Per applicant | Field recorded |
| Overdraft | `MainContent_txtExpenditure_000043_<i>` | `outgoings.overdraftBalances` | Per applicant; adapter places aggregate on applicant 1 | 05, 10 |

## Results

The real results page contains the step label `Results` and result text matching:

```text
Maximum loan amount: £409,200.00
```

Extraction must use the focused pattern `Maximum loan amount:\s*£...` and must reject pages containing validation text such as `You must`, `Please specify`, `Please enter`, or `required`.

## Validation Text Observed

```text
Please specify if the property is new build or not.
Please specify if long term fixed rate
Please specify a repayment type
You must enter Annual Basic Income (Before Deductions) for applicant 1
You must select whether there is any other income
```
