# Santander Completion Analysis

This document is a working analysis for completing the Santander adapter with fewer failed cases. It is based on the current code, current samples, and the failures seen during the recent HSBC/Santander/Nationwide work.

Primary files:

```text
src/adapters/santander/adapter.ts
src/adapters/santander/mapping.ts
samples/santander/*.json
artifacts/screenshots/santander-*.png
```

## Current State

The Santander adapter exists and can navigate the calculator, but it is still fragile. The main technical smell is that it mixes three different strategies:

```text
1. Visible UI filling with generic label matching
2. Exact ID filling for a few fields
3. Direct Vue/Pinia store mutation
```

That mix can hide real form-state problems. It also makes false success likely if the store says one thing but the visible page is still on a validation step. Santander must be stabilized with exact field mapping and visible-page validation before more samples are trusted.

## Known High-Risk Areas

### 1. Other Mortgages / Other Properties

This is the biggest known issue.

Current code:

```ts
const hasOtherProperties = input.otherProperties.length > 0 || input.outgoings.otherMortgageCommitments.length > 0;
await chooseFirstAvailableOption(page, hasOtherProperties ? ["Yes"] : ["No"], ["other properties", "currently own"]);
await selectFirstAvailableOption(page, ["How many mortgaged properties", "mortgaged properties"], [
  String(Math.min(input.otherProperties.length + input.outgoings.otherMortgageCommitments.length, 5))
]);
...
const firstProperty = input.otherProperties[0];
if (firstProperty) {
  ...
}
```

Problems:

```text
It counts both otherProperties and otherMortgageCommitments.
It only fills input.otherProperties[0].
It does not fill second, third, etc. generated property cards.
It does not fill any generated cards that came from otherMortgageCommitments.
It uses generic labels, so repeated property-card fields can target the wrong card.
It does not map ownership/applicant relationship for joint cases.
It does not distinguish mortgaged property vs mortgage-free property.
It does not fill lender-specific required fields such as property usage, repayment type, property type, bedrooms, rent status, or whether it is let at market value if these appear.
```

Expected fix:

```text
Build exact field map for each repeated Santander property card.
Select number of mortgaged properties from actual modeled cards.
Generate a normalized list of "SantanderOtherPropertyCard" values.
Fill every card by index.
For missing details in otherMortgageCommitments, create conservative defaults and document them.
Do not let otherMortgageCommitments create a visible card unless the adapter can fill every required field for that card.
```

Recommended normalized structure inside the adapter:

```ts
interface SantanderOtherPropertyCard {
  index: number;
  propertyValue: number;
  mortgageBalance: number;
  monthlyMortgagePayment: number;
  monthlyRent: number;
  isRental: boolean;
  repaymentType: RepaymentType;
  source: "otherProperties" | "otherMortgageCommitments";
}
```

Mapping rule:

```text
Use otherProperties[] first because it contains propertyValue, rent, balance, payment, repayment type.
Use otherMortgageCommitments[] only if Santander's UI has a specific commitment-only path or if defaults are accepted.
If generated property card count is N, fill exactly N cards.
```

### 2. False Success Risk

A major Santander issue already happened: the adapter returned success even though the visible form was not on a real result page. That must never repeat.

Current `extractResult` is improved because it checks:

```ts
resultState.routeName !== "Results"
```

But further hardening is still needed:

```text
Confirm active route/page is Results.
Confirm visible calculator text contains Results/result wording.
Reject success if visible calculator text contains validation markers.
Extract currency only from Santander result state or visible Results section, never from the full page.
Include validation messages in failed output where possible.
```

Recommended guard:

```text
Success requires:
1. Vue route name is Results, or visible step/tab is Results.
2. No validation container is visible.
3. Result text includes lender result language.
4. maximumBorrowing is extracted from result-specific state/text.
```

### 3. Remortgage Current Balance

Known failure:

```text
For remortgage cases, current balance was not being filled correctly.
Some sample JSON did not expose loan.currentBalance.
Current fallback uses loan.currentBalance ?? loan.loanAmount.
```

Current code:

```ts
function santanderCurrentBalance(input: LenderReadyInput): number {
  return Math.round(input.loan.currentBalance ?? input.loan.loanAmount);
}
```

This is probably too rough. For remortgage/further advance, Santander may need:

```text
Current outstanding balance
Additional borrowing amount
Total loan required
Interest-only amount
Capital-and-interest amount
```

Recommended fix:

```text
Update samples so remortgage/further advance cases include loan.currentBalance.
Use loan.currentBalance when available.
For old samples without it, derive from first existing mortgage only if clearly representing current main residence.
Do not silently use loan.loanAmount if Santander displays a current-balance field and the sample has no currentBalance. Prefer validation or explicit default documented in the sample.
```

### 4. Income Section

Current income logic is incomplete and partly hidden by direct store mutation.

Current problems:

```text
Self-employed visible fields were not always filled.
Director/limited-company fields may require salary and dividends separately.
Sole trader, partnership, and LLP may use different labels/IDs.
Applicant 2 can have different IDs from applicant 1.
Pension income and otherAnnualPensionIncome may map to different visible fields.
Bonus/overtime/commission are not currently filled from input even though contracts contain them.
Other income is collapsed into one generic field, but Santander may require typed breakdown.
```

Current code hard-codes:

```ts
const annualBonus1 = 0;
const annualOvertime = 0;
const annualCommission = 0;
```

That means samples with bonus, overtime, or commission are not fully represented.

Recommended fix:

```text
Map applicant 1 and applicant 2 fields separately.
Create exact fillers for:
  employed basic income
  bonus
  overtime
  commission
  pension
  state/other pension
  sole trader latest/previous
  partnership/LLP latest/previous or share fields
  limited company director salary latest/previous
  limited company dividends latest/previous
  other income
Stop relying on Pinia mutation as the primary path; use it only as a last-resort synchronization aid if needed.
```

### 5. Mortgage Details

Current code fills mortgage details twice:

```ts
await setSantanderDetailsStore(page, input);
...
await setSantanderDetailsStore(page, input);
```

This duplication is a sign that visible UI state was not reliable.

Risks:

```text
Fields may be hidden or disabled depending on mortgage type.
InterestOnlyAmt was previously hidden and timed out.
Part-and-part must split loan amount correctly.
Remortgage reason must be exact.
TermYears and TermMonths must be selected by values accepted by Santander.
Oldest applicant next birthday age must match Santander's wording.
```

Recommended fix:

```text
Create exact field map for Mortgage details.
Fill each visible field once.
After setting mortgage type/repayment type, wait for dependent fields to appear.
Only fill InterestOnlyAmt when visible and applicable.
Only fill CapitalAndInterestAmt when visible and applicable.
Use a post-fill verification snapshot for key values.
Remove duplicate fill/store patches after exact mapping is stable.
```

### 6. Commitments and Expenditure

Current outgoings logic is too broad:

```text
monthlyBuyToLetPayments is merged into otherMonthlyOutgoings.
Mortgage payments on other properties may already be represented in Other properties.
This can double count BTL mortgage payments.
Credit card balances and overdrafts are combined into credit card balances.
Some Santander fields may distinguish loans, credit cards, childcare, ground rent, service charge, school fees, maintenance, etc.
```

Recommended fix:

```text
Map each visible Santander expenditure field.
Avoid double counting monthlyBuyToLetPayments if already entered in other property cards.
Use conservative zero fills for fields not represented in LenderReadyInput.
Document unsupported fields explicitly.
```

## Detailed Completion Plan

### Phase 1: Stabilize Observability

Goal: every failure should tell us the exact visible validation and current calculator section.

Tasks:

```text
Enhance Santander failure messages with visible calculator step/section.
Return santanderValidationMessages in failures, especially result_extraction failures.
Capture route name and current heading.
For result extraction, include whether routeName is Results.
```

Success criteria:

```text
If Santander fails, JSON error tells whether it is Mortgage details, Other properties, Income, Commitments, or Results.
```

### Phase 2: Create Santander Field Map

Goal: stop guessing selectors.

Create:

```text
docs/SANTANDER_FIELD_MAP.md
```

Minimum sections:

```text
Mortgage details
Other properties
Income applicant 1
Income applicant 2
Commitments and expenditure
Results
```

For each field:

```text
Question text
DOM id/name
Vue/Pinia property if known
Input source path
Options/values
Conditional trigger
Sample coverage
```

### Phase 3: Rewrite Other Properties / Other Mortgages

Goal: fix the biggest known issue first.

Tasks:

```text
Build normalized SantanderOtherPropertyCard list.
Select "owns other properties" exactly.
Select exact number of mortgaged properties.
Select exact number of mortgage-free properties.
Fill every generated mortgaged property card by index.
Support at least 0, 1, and 2 property cards.
Map property value, outstanding balance, monthly payment, rent, let/market-rent status.
Map repayment type if Santander asks it.
Map property use/type/bedrooms if Santander asks it.
Do not count both otherProperties and otherMortgageCommitments unless both can be represented without duplication.
```

Tests to run after this phase:

```powershell
node dist\cli.js .\samples\santander\01-purchase-employed-standard.json
node dist\cli.js .\samples\santander\09-purchase-joint-pension-llp-other-property.json
node dist\cli.js .\samples\santander\10-remortgage-multiple-mortgages-high-outgoings.json
```

### Phase 4: Rewrite Income Mapping

Goal: make all employment types real UI fills.

Tasks:

```text
Applicant 1 and applicant 2 exact field IDs.
Employed: basic, bonus, overtime, commission.
Contractor: contractor-specific controls if Santander exposes them.
Sole trader: latest/previous profit.
Partnership/LLP: exact fields, not assumed same as sole trader.
Limited company: director salary + dividends.
Pension: private/state/other pension.
Other income: map known types or fill accepted aggregate field.
```

Tests:

```powershell
node dist\cli.js .\samples\santander\02-purchase-joint-employed-self-employed-dependants.json
node dist\cli.js .\samples\santander\04-remortgage-capital-raising-limited-company-part-and-part.json
node dist\cli.js .\samples\santander\07-purchase-scotland-leasehold-partnership-other-income.json
node dist\cli.js .\samples\santander\09-purchase-joint-pension-llp-other-property.json
```

### Phase 5: Remortgage and Further Advance

Goal: make current balance and remortgage reason reliable.

Tasks:

```text
Add loan.currentBalance to remortgage/further-advance samples where missing.
Fill current balance with exact ID.
Verify remortgage reason select values.
Distinguish:
  remortgage_no_additional_borrowing
  remortgage_capital_raising
  further_advance
Check whether Santander has a true further advance path or represents it as remortgage with additional borrowing.
```

Tests:

```powershell
node dist\cli.js .\samples\santander\03-remortgage-no-additional-pension-interest-only.json
node dist\cli.js .\samples\santander\04-remortgage-capital-raising-limited-company-part-and-part.json
node dist\cli.js .\samples\santander\05-further-advance-contractor-heavy-outgoings.json
node dist\cli.js .\samples\santander\08-remortgage-other-employment-benefits.json
node dist\cli.js .\samples\santander\10-remortgage-multiple-mortgages-high-outgoings.json
```

### Phase 6: Result Extraction Hardening

Goal: no false success.

Tasks:

```text
Keep routeName === "Results" requirement.
Add visible Results heading requirement.
Fail if validation/error containers are visible.
Extract from Santander result state first.
Fallback only to #AffordabilityCalculator Results section text.
Never extract from full body text.
```

Tests:

```text
Run one valid case and one deliberately invalid case.
Valid case must return success.
Invalid case must return failed with validation, never success.
```

## Recommended Test Matrix

The current 10 Santander samples are a good base, but each needs an expected branch checklist.

```text
01 purchase employed standard
  Covers: purchase, single, employed, no other properties, capital-and-interest

02 purchase joint employed self-employed dependants
  Covers: joint, dependants, applicant 2 self-employed

03 remortgage no additional pension interest-only
  Covers: remortgage, pension, interest-only, current balance

04 remortgage capital raising limited company part-and-part
  Covers: director salary/dividends, part-and-part, current balance

05 further advance contractor heavy outgoings
  Covers: contractor, further advance, high commitments

06 purchase shared ownership sole trader
  Covers: shared ownership, sole trader

07 purchase Scotland leasehold partnership other income
  Covers: Scotland, leasehold, partnership/LLP-like fields, other income

08 remortgage other employment benefits
  Covers: other employment, benefits/other income, remortgage current balance

09 purchase joint pension LLP other property
  Covers: pension + LLP + other property card

10 remortgage multiple mortgages high outgoings
  Covers: multiple other mortgage/property cards, remortgage, high outgoings
```

For each sample, add or confirm:

```text
loan.currentBalance for remortgage/further advance
otherProperties[].propertyValue
otherProperties[].currentBalance
otherProperties[].monthlyMortgagePayment
otherProperties[].monthlyRent
otherProperties[].remainingTermYears
employment business subtype
expected visible income fields
expected other-property card count
```

## Priority Order

Recommended order for the next coding session:

```text
1. Improve failure diagnostics and result guards.
2. Create Santander field map from live calculator.
3. Fix Other properties / Other mortgages by exact indexed fields.
4. Fix income exact fields by employment type.
5. Fix remortgage/current balance samples and adapter logic.
6. Run all 10 Santander samples one by one.
7. Only then remove or reduce direct Pinia store mutation.
```

## Definition of Done

Santander should be considered complete only when:

```text
All 10 Santander samples reach the real Results page or fail for an intentional lender validation reason.
No sample returns success from a non-Results page.
Failure output includes useful validation text.
Other property/mortgage samples with 0, 1, and 2 cards are covered.
Applicant 1 and applicant 2 income paths are covered.
Purchase, remortgage, further advance, capital-and-interest, interest-only, and part-and-part are covered.
```

