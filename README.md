# Mortgage Affordability Automation

Browser automation service for UK mortgage intermediary affordability calculators.

The first lender adapter is Halifax Intermediaries. Barclays has also been added as the second adapter slice. The service accepts lender-ready JSON, fills the lender calculator, calculates affordability, and returns a structured result.

## Current Scope

- Input is already converted by an upstream rules layer.
- This project owns browser automation, calculator interaction, result extraction, evidence capture, and operational reliability.
- Raw fact-find to lender-ready conversion is intentionally left outside this implementation slice.

## Halifax Calculator

- Parent page: `https://www.halifax-intermediaries.co.uk/tools-calculators/mortgage-affordability-calculator.html`
- Direct calculator page: `https://www2.halifax-intermediariesonline.co.uk/tools/calculator/`

The direct calculator URL is preferred for automation.

In this environment, Halifax may return its own system-problem page to fresh standalone browser automation while the same calculator remains reachable in an existing trusted browser session. The project therefore separates execution mode from lender mapping:

- `managed`: launch a Playwright browser owned by the service.
- `attached`: connect to a trusted browser/session over Chrome DevTools Protocol.

## Commands

```powershell
npm install
npm run check
npm run dev
npm run samples
```

`npm run dev` runs the CLI against `samples/halifax-input.json`.
`npm run samples` builds the project and runs every JSON input in `samples/` sequentially.

## Attached Browser Mode

Start a visible browser with remote debugging:

```powershell
npm run attached:browser
```

Open `http://127.0.0.1:9222/json/version`, copy `webSocketDebuggerUrl`, then run:

```powershell
$env:BROWSER_EXECUTION_MODE="attached"
$env:BROWSER_WS_ENDPOINT="ws://127.0.0.1:9222/devtools/browser/..."
$env:HEADLESS="false"
npm run build
node dist/cli.js samples/halifax-input.json
```

Use this mode for lender sites that allow a normal browser session but reject fresh automation contexts. Credentials and broker portal sessions must stay in the browser profile, not in source code or environment variables.

Verified Halifax attached-mode output for `samples/halifax-input.json`:

```json
{
  "lender": "halifax",
  "status": "success",
  "maximumBorrowing": 537310
}
```

Verified Barclays managed-mode output for `samples/barclays-input.json`:

```json
{
  "lender": "barclays",
  "status": "success",
  "maximumBorrowing": 285000
}
```

## Architecture

```text
Lender-ready JSON
        -> Validation
        -> Lender adapter selection
        -> Browser automation
        -> Result extraction
        -> Structured JSON + evidence
```

For a fast project handoff in a new conversation, start with [docs/PROJECT_HANDOFF.md](docs/PROJECT_HANDOFF.md).

See [docs/PLAN.md](docs/PLAN.md) and [docs/HALIFAX_FIELD_MAP.md](docs/HALIFAX_FIELD_MAP.md).
See [docs/BARCLAYS_FIELD_MAP.md](docs/BARCLAYS_FIELD_MAP.md) for the Barclays adapter slice.
