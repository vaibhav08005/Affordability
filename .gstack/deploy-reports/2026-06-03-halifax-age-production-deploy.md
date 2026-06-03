# Halifax Age Production Deploy

Timestamp: 2026-06-03T15:01:20.661Z

Commit:
- `8292ab691010b830f8d71003ac852be307c31cee`
- Message: `fix: harden Halifax applicant age selectors`
- Pushed to `origin/main`.

Pre-deploy verification:
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed with no test files discovered.
- Local Playwright smoke test filled `#age-one` in the downloaded production Halifax failure HTML.

Deployment:
- Worker service: `mortgage-affordability-worker`
- Worker revision: `mortgage-affordability-worker-00004-lcb`
- API service: `mortgage-affordability-demo`
- API revision: `mortgage-affordability-demo-00027-bnm`
- Region: `europe-west2`
- Project: `project-2da37e36-5c70-4e06-9f7`

Production verification:
- Health endpoint returned `{"status":"ok"}`.
- Triggered production run for case `01-ftb-single-employed`.
- Run id: `YFVKcqOYGviewn7h0ed1`
- Halifax result: `success`
- Halifax affordability amount: `309650`
- This confirms the production applicant-age selector failure no longer reproduces for case 1.

Verdict: deployed and verified.
