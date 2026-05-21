# Kensington Field Map

Calculator inspected: `https://www.kensingtonmortgages.co.uk/archive/calculators/residential`

Public URL `https://www.kensingtonmortgages.co.uk/intermediaries/calculators/residential` loads the archived residential calculator. The calculator is a one-page Knockout form; `Calculate` appends `RESIDENTIAL RESULTS` to the same page.

| Step | Question text | Field ID/name or selector | Input source path | Conditional trigger | Test case coverage |
| --- | --- | --- | --- | --- | --- |
| Application details | Client Name (Customer's name) | `#clientName`, `data-bind="textInput: clientName"` | generated from lender/case | Always visible | 01-10 |
| Application details | What will the mortgage term be? | `#loan_term_requested`, `data-bind="textInput: term"` | `case.termYears` | Always visible | 01-10 |
| Application details | What type of mortgage will it be? | Button text `Purchase`; button text `Remortgage` in application section | `case.mortgagePurpose` | Purchase for `purchase`; remortgage for remortgage/further advance | 01-10 |
| Application details | Product range | `#product` | Kensington default `Residential Select`; `Residential Shared Ownership` when `sharedOwnershipOrEquity=true` | Always visible | 01-10 |
| Application details | Product | `#product1`, options from `selectedRangeProducts` | selected from product options by initial period (`journey` text), LTV, and lowest/nearest current rate in option text | Product options load after product range | 01-10 |
| Application details | Initial rate period / initial rate / reversion rate | Auto-populated text fields from selected product | selected product | Read-only display after product selection | 01-10 |
| Application details | Purchase Price/Property Value | `#property_valuation`, `data-bind="textInput: property_valuation.formatted"` | `loan.propertyValue` | Always visible | 01-10 |
| Application details | How much are you looking to borrow? | `#loan_amount`, `data-bind="textInput: loan_amount.formatted"` | `loan.loanAmount` | Always visible | 01-10 |
| Application details | Was the original purchase made with the assistance of a Help to Buy equity loan scheme? | Yes/No buttons after question | `case.sharedOwnershipOrEquity` | Remortgage only | 03, 04, 05, 08, 10 |
| Application details | Is the application defined as credit impaired? | Yes/No buttons after question | default `No` | Always visible | 01-10 |
| Application details | Do you know the property details? | Yes/No buttons after question | default `Yes` | Always visible | 01-10 |
| Application details | Property Postcode | `#postcode`, `data-bind="textInput: property_postcode"` | derived from `property.isInScotland` | Visible when property details = Yes | 01-10 |
| Annual income | Is this a single or joint application? | Button text `Single Applicant`; `Joint Applicant` | `case.numberOfApplicants` | Joint reveals second applicant section | 01-10 |
| Applicant income | Postcode of main residence | Repeated `#post_code`, `data-bind="textInput: post_code"` by applicant index | derived from `property.isInScotland` | Per applicant | 01-10 |
| Applicant income | Date of birth | Repeated `#date_of_birth`, `data-bind="text: date_of_birth, value: date_of_birth"` by applicant index | `applicants[n].dateOfBirth` or generated from `age` | Per applicant | 01-10 |
| Applicant income | Estimated retirement age | Repeated `#planned_retirement_age`, `data-bind*="planned_retirement_age"` by applicant index | `applicants[n].retirementAge` or 70 | Per applicant | 01-10 |
| Applicant income | Current employment status | Repeated `select[data-bind*="employment_status"]` by applicant index | employed, self-employed, contractor, retired, not employed | Employment status changes visible income fields | 01-10 |
| Applicant income | Basic salary | `input[data-bind*="salary.formatted"]` in applicant index | `employment.annualGrossIncome` | Employed only | 01, 02, 08, 10 |
| Applicant income | Bonus / Commission / Overtime / Allowance | `bonus.formatted`, `commission.formatted`, `overtime.formatted`, `allowances.formatted` by applicant index | `annualBonus`, `annualCommission`, `annualOvertime`, selected other income total fallback | Employed only | 02, 08, 10 |
| Applicant income | Gross earnings derived from business (last year) | `input[data-bind*="salary.formatted"]`; becomes `id="salary"` for self-employed/contractor | self-employed profit or contractor gross income | Self-employed and contractor | 02, 04, 05, 06, 07, 09 |
| Applicant income | Retired / Not Employed income | Add button plus `#Select4`, `income_amount.formatted`, `#income_start_date` | pension and other income | Retired/not employed have no base salary field; income goes through other income row | 03, 08, 09 |
| Applicant income | Other income | Repeated Add button `data-bind="click: addincomedd"`; row has `#Select4`, `income_amount.formatted`, `#income_start_date` | `otherIncome[]`, pension fallback | Clicking Add reveals row | 03, 07, 08, 09 |
| Monthly expenditure | Number of dependants | Buttons `0`, `1`, `2`, `3`, `4+` in expenditure section | `household.dependants.length` | Always visible | 01-10 |
| Monthly expenditure | Age of dependant 1..4 | Repeated `input[data-bind="textInput: age"]` by dependant index | `household.dependants[n].age` | Visible after dependant count greater than zero; required whole number greater than zero | 02, 05, 08, 09, 10 |
| Monthly expenditure | Shared ownership rent | `#shared_ownership_rent`, `data-bind="textInput: shared_ownership_rent.formatted"` | `case.monthlySharedOwnershipRent` | Visible and required for Residential Shared Ownership product selection | 06 |
| Monthly expenditure | Ground Rent and Service Charges | `#ground_rent_service_charge` | leasehold/service-charge assumption from property tenure | Always visible | 06, 07 |
| Monthly expenditure | Childcare/Nursery Costs | `#childcare` | estimated from child dependants | Always visible | 02, 05, 09 |
| Monthly expenditure | Maintenance | `#maintenance` | maintenance outgoings fallback | Always visible | 05, 10 |
| Monthly expenditure | School and Education Costs | `#school_fees` | `outgoings.otherMonthlyOutgoings` portion | Always visible | 05, 10 |
| Monthly expenditure | Current outstanding credit commitments | `#credit_expenditure1` | `outgoings.monthlyLoanRepayments` plus other mortgage monthly payments | Always visible | 05, 10 |
| Monthly expenditure | Outstanding revolving credit balances | `#revolvingCreditBalance` | `creditCardBalances + overdraftBalances` | Always visible | 05, 10 |
| Results | Calculate | `#SubmitButton`, `data-bind="click: calculate"` | n/a | Appends `RESIDENTIAL RESULTS` or validation text | 01-10 |
| Results | Maximum lending | Text pattern `The maximum we may lend you is (including fees) £...` | result extraction | Only valid after `RESIDENTIAL RESULTS`; validation text rejects success | 01-10 |

Known validation/result text:

- Results marker: `RESIDENTIAL RESULTS`
- Success amount: `The maximum we may lend you is (including fees) £381,650`
- Validation/safety guard patterns: `Please`, `required`, `must`, `Select`, `Calculate`

Kensington-specific assumptions:

- The public calculator does not expose a repayment-type field. `interest_only` and `part_and_part` inputs are accepted by the adapter but are not selectable in this calculator.
- The public calculator does not expose separate existing-mortgage or other-property cards. Related inputs are represented through the available expenditure fields.
- Default product range is `Residential Select`; shared ownership cases use `Residential Shared Ownership` because that is the lender-specific product range that opens the shared ownership products.
- Product selection uses option text: requested initial period from `case.journey` when it contains `2yr` or `5yr`, otherwise `5yr`; LTV bucket is the smallest bucket at or above actual LTV; when multiple products match, the lowest rate is selected.
