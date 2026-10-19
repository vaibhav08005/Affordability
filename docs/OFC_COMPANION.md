# Open Filled Calculator companion

The website's **Open filled calculator** button opens installed Google Chrome on the user's computer. The local companion receives a short-lived ticket, fetches the mapped case, and runs the exact lender adapter files included in the server build. The adapter stops before its final calculate action. Chrome stays open so the user can edit the lender form.

## Build and distribute

Build both the server and companion from the same checkout:

```powershell
npm ci
npm run companion:stage
npm --prefix companion ci
npm --prefix companion run pack:win
```

The Windows installer and its `latest.yml` update metadata are created in `companion/release/`. On macOS use `npm --prefix companion run pack:mac`; on Linux use `npm --prefix companion run pack:linux`. Build and test each target on its own operating system. The first installation is manual; later versions can download and install automatically. The update feed must be served over HTTPS.

The root `npm run companion:stage` command compiles the project and copies the compiled lender adapters and companion entry point into `companion/dist/`. This is a build artifact. Do not edit the copied files; edit `src/adapters/` and rebuild. The server and companion compare a fingerprint for the selected lender and shared adapter code. A change limited to Halifax blocks only Halifax until the companion updates. A change in `src/adapters/shared/`, `src/adapters/types.ts`, or `src/domain/validation.ts` can affect every lender.

## Companion releases

The [companion release workflow](../.github/workflows/ofc-companion-release.yml) is manual-only while signing and release setup is being completed. Once the required credentials are configured, select **Actions > Publish OFC companion > Run workflow** on `main`. Pushing application code does not publish an installer. The workflow builds the server and companion from the same commit, tests them, assigns a version `0.2.<workflow run number>`, builds signed Windows and macOS installers plus Linux packages, and publishes binaries before update metadata. If any platform build fails, it publishes nothing. The [publisher](../scripts/publish-companion-release.mjs) uses the project's existing Google Cloud Storage dependency and writes to a public HTTPS update prefix. It also updates stable installer names for the setup page.

Before enabling the workflow, configure these GitHub repository settings:

The Google Cloud release resources are provisioned in `project-2da37e36-5c70-4e06-9f7`:

- Update bucket: `mortgage-ofc-476501925780` (`europe-west2`, public read; only signed release files belong here).
- Update prefix: `open-filled-calculator`.
- Workload identity provider: `projects/476501925780/locations/global/workloadIdentityPools/ofc-companion-release/providers/github-main`.
- Publisher service account: `ofc-companion-publisher@project-2da37e36-5c70-4e06-9f7.iam.gserviceaccount.com`.

The provider accepts GitHub Actions tokens only from `vaibhav08005/Affordability` on `refs/heads/main`; the publisher has object-admin access only to the update bucket. Set the GitHub variables and secrets below before running the release workflow. The current Windows signing step expects an exportable certificate; a hardware-backed or cloud signing provider requires adapting the signing integration first. Do not set the server's `OFC_UPDATE_FEED_URL` until the first signed release has been published and its installer links return HTTP 200.

| Setting | Use |
| --- | --- |
| Variable `OFC_UPDATE_BUCKET` | Cloud Storage bucket holding public update downloads. |
| Variable `OFC_UPDATE_PREFIX` | Optional object prefix; defaults to `open-filled-calculator`. |
| Secrets `OFC_GCP_WORKLOAD_IDENTITY_PROVIDER`, `OFC_GCP_SERVICE_ACCOUNT` | Workload Identity Federation for a service account with write access to that prefix. |
| Secrets `OFC_WINDOWS_CSC_LINK`, `OFC_WINDOWS_CSC_PASSWORD` | Windows signing certificate and password. |
| Secrets `OFC_MAC_CSC_LINK`, `OFC_MAC_CSC_PASSWORD` | Apple Developer ID certificate and password. |
| Secrets `OFC_APPLE_ID`, `OFC_APPLE_APP_SPECIFIC_PASSWORD`, `OFC_APPLE_TEAM_ID` | macOS notarization credentials. |

Grant the release service account write and overwrite access to the update bucket or prefix (for example, `roles/storage.objectAdmin` scoped to that bucket), and make only the published update objects publicly readable. Set the deployed server's `OFC_UPDATE_FEED_URL` to `https://storage.googleapis.com/<bucket>/<prefix>/`. The website derives first-install links from that feed. The `OFC_DOWNLOAD_URL_WINDOWS`, `OFC_DOWNLOAD_URL_MACOS`, and `OFC_DOWNLOAD_URL_LINUX` settings can still override those links.

Publish the companion workflow successfully for the same commit before deploying a server adapter change. Otherwise that lender pauses until its companion release is available. A previously installed 0.1.x companion has no updater and must be upgraded manually once to 0.2.0 or a later signed release. Thereafter the companion checks for releases on startup, on OFC clicks, and every six hours while running. If a lender fingerprint differs, it checks immediately, downloads the update, and installs after all open Chrome sessions finish. The user clicks OFC again after the companion restarts; a consumed ticket is never replayed.

## Server configuration

Set `OFC_PUBLIC_URL` to the exact public HTTPS origin of the deployed website, for example `https://calculator.example.com`. The local development server at `http://localhost:3000` works without this setting. Set `OFC_UPDATE_FEED_URL` after publishing the signed installers and update metadata. For local OFC development, run `npm run companion:stage` after adapter edits so the development server and companion use matching compiled code.

On a cloud deployment, enable `RUN_STATE_BACKEND=firestore` or Cloud Tasks so the handoff ticket repository uses Firestore across server instances. Configure a Firestore TTL policy on the `ofcTickets` collection's `deleteAt` field to remove expired, unused tickets. Ticket redemption uses a Firestore transaction and deletes a used ticket immediately. The ticket carries no case data in the browser URL; the mapped input is fetched once over HTTPS. The current project has no built-in account authentication or per-case permissions, so protect the website with your deployment's access control before exposing real client cases.

The website container does not need Electron or the companion files. Deploy the normal `dist/`, `public/`, and case data. The user installs the companion once and needs Google Chrome. No lender login, Chrome extension, Node.js, npm, or Playwright browser download is required on the user's PC.

## User flow

1. Install Chrome and the companion for Windows, macOS, or a supported Linux distribution.
2. Open a case on the cloud website and click **Open filled calculator** for a lender.
3. Allow the browser's external-app prompt. On the first run, approve the website origin shown by the companion.
4. Chrome opens in a temporary, separate profile. The mapped fields are filled using the shared lender adapter. Edit the fields and, if desired, calculate manually on the lender site.
5. Close the Chrome window when finished. The companion removes that temporary profile.

The one-use ticket expires after two minutes. If it expires, click the website button again. If a lender's adapter differs, the companion downloads a newer release when one has been published and installs it after Chrome sessions close. Click the website button again afterward. The website does not receive the user's later edits, affordability result, or screenshots from the companion.

## Verification

`npm run companion:stage` and `npm test` verify the TypeScript build and ticket behavior. The Windows package was built with Electron Builder and its packaged adapter import and installed Chrome launch were checked on Windows. Each lender's live form needs an end-to-end run on each target OS because lender websites can change. The macOS and Linux installers need to be built and tested on those systems.
