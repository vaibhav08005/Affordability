# Halifax Raw Mapping Cases

These files are raw fact-find style YAML samples for testing the Halifax mapping layer.

Run all cases:

```powershell
npm.cmd run map:halifax:cases
```

The command writes lender-ready JSON files to:

`samples/halifax-mapped-cases`

## Coverage

| Case | Scenario |
| --- | --- |
| `halifax-raw-case-01-ftb-single-employed.yaml` | First-time buyer, single applicant, employed income, credit card balance. |
| `halifax-raw-case-02-home-mover-joint-btl-shortfall.yaml` | Home mover, joint applicants, deposit sources, BTL shortfall, residential mortgage commitment. |
| `halifax-raw-case-03-shared-ownership-purchase.yaml` | Shared ownership purchase, leasehold, rent under scheme, child benefit and childcare. |
| `halifax-raw-case-04-shared-equity-interest-only.yaml` | Shared equity / Help to Buy style purchase, interest-only, repayment vehicle contribution. |
| `halifax-raw-case-05-scotland-remortgage-leasehold.yaml` | Scottish postcode, leasehold, remortgage without extra borrowing, overdraft. |
| `halifax-raw-case-06-remortgage-capital-raising-ltd-company.yaml` | Remortgage capital raising, part-and-part, limited company director income, three dependants. |
| `halifax-raw-case-07-further-advance-contractor-day-rate.yaml` | Further advance, contractor day-rate income, loan commitment. |
| `halifax-raw-case-08-sole-trader-pension-other-income.yaml` | Sole trader, pension income, benefit income, commonhold tenure. |
| `halifax-raw-case-09-joint-partnership-and-llp.yaml` | Joint self-employed applicants, partnership and LLP income, residential mortgage commitment. |
| `halifax-raw-case-10-retired-pensioner-interest-only.yaml` | Retired applicant, pension income, Scottish postcode, interest-only remortgage. |
