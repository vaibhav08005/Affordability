# Test Case Gap Analysis

Scope: `samples/test-cases`

## Current Coverage Snapshot

The current suite has 30 raw Halifax-style fact-find YAML cases.

| Dimension | Existing coverage |
| --- | --- |
| Journey | 7 FTB, 12 home mover, 9 residential remortgage, 2 further advance |
| Applicant count | 18 single, 12 joint |
| Ownership | 26 standard, 2 shared ownership, 2 shared equity / HTB |
| Repayment | 23 capital and interest, 4 interest-only, 3 part-and-part |
| Tenure | Freehold, leasehold, commonhold, share of freehold |
| Employment | Employed, contractor, self-employed, retired, not working |
| Self-employment | Sole trader, limited company, partnership, LLP |
| Commitments | Cards, overdrafts, loans, student loan, hire purchase, lease, BNPL-style loan grouping |
| Other properties | BTL shortfall, residential mortgage commitment, mixed property exposure |

## Main Gaps

1. Data-quality and default handling: no existing case intentionally omits date of birth, postcode, or tenure, so mapper warnings are not regression-tested.
2. Boundary loan calculations: paydown greater than current balance, source-only deposits, and zero/near-zero loan outputs need explicit tests.
3. Frequency annualisation: weekly is represented, but fortnightly, every-four-weeks, quarterly, and half-yearly income paths need more direct assertion.
4. Bonus rule: the lower-of-latest-vs-average bonus calculation should have a deliberately asymmetric case.
5. BTL treatment: current cases include shortfalls, but BTL surplus must be proven not to increase affordability.
6. Relationship/dependant filtering: spouse/partner exclusion is covered indirectly; non-spouse joint applicants with adult dependants should be retained.
7. Regional rules: Scotland is represented, but `G` postcode detection without an explicit country value needs a direct case.
8. Field aliases: additional borrowing aliases and deposit-source fallback should be protected because these are common integration-risk points.
9. Negative and non-happy paths: the suite is mostly valid production-like data; add controlled mapping-warning and financial edge cases.
10. Cross-lender mapped regression: this folder is not the default input for `npm run map:<lender>:cases`; custom folder execution should be included in regression instructions.

## Generated Cases Added

| Case | Purpose | Expected focus |
| --- | --- | --- |
| `additional-raw-case-31-deposit-source-no-explicit-deposit.yaml` | Purchase using only deposit source details | Deposit fallback, loan amount calculation |
| `additional-raw-case-32-missing-core-fields-defaults.yaml` | Missing DOB, postcode, and tenure | Mapping issues, default age, default Scotland flag, default tenure |
| `additional-raw-case-33-frequency-annualisation-and-bonus-lower-of.yaml` | Mixed income frequencies and asymmetric bonus | Fortnightly, quarterly, half-yearly annualisation, bonus lower-of rule |
| `additional-raw-case-34-btl-surplus-and-residential-commitment.yaml` | BTL surplus plus residential second property | BTL surplus ignored, residential mortgage commitment retained |
| `additional-raw-case-35-remortgage-paydown-exceeds-balance.yaml` | Remortgage where paydown exceeds balance | Non-negative loan amount floor |
| `additional-raw-case-36-further-advance-additional-borrowing-alias-bnpl.yaml` | Further advance using additional borrowing alias | Alias mapping, BNPL monthly repayment grouping |
| `additional-raw-case-37-scotland-g-postcode-outright-default.yaml` | Scottish `G` postcode without country | Scotland postcode detection, Scottish tenure default |
| `additional-raw-case-38-joint-non-spouse-dependants-retained.yaml` | Joint siblings with dependant relationships | Non-spouse dependant retention |

## Recommended Next Areas

| Priority | Area | Suggested new case |
| --- | --- | --- |
| P1 | Cross-lender parity | Run the same raw case pack through Barclays, HSBC, Skipton, and Virgin Money mappers and compare validation failures/issues |
| P1 | UI/API run endpoint | Case selection from mapped folders where normalized filename IDs must match across lenders |
| P1 | Validation failure handling | Invalid retirement age, term over 40 years, negative money, malformed dependant age |
| P2 | International applicant details | Non-sterling income, visa/residency combinations, foreign address history |
| P2 | Property charges | Ground rent, service charge, and shared-equity monthly interest once supported by contract/adapter |
| P2 | Regulated affordability stress | High LTV with high commitments, childcare plus maintenance plus dependants |
| P3 | Format tolerance | Numeric strings with commas, blank strings, and mixed enum wording from upstream fact-find systems |

## Suggested Regression Commands

```powershell
npm.cmd run build
node scripts\map-halifax-raw-cases.mjs samples\test-cases tmp\halifax-test-cases
node scripts\map-barclays-raw-cases.mjs samples\test-cases tmp\barclays-test-cases
node scripts\map-hsbc-raw-cases.mjs samples\test-cases tmp\hsbc-test-cases
node scripts\map-skipton-raw-cases.mjs samples\test-cases tmp\skipton-test-cases
node scripts\map-virgin-money-raw-cases.mjs samples\test-cases tmp\virgin-money-test-cases
```
