const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { parseLink } = require("./link.cjs");
const { autoUpdater } = require("electron-updater");
const { createUpdateManager } = require("./updater.cjs");

const activeSessions = new Set();
const pendingLinks = [];
let activeJobs = 0;
let statusWindow;
let currentStatus = { title: "Ready", detail: "Click Open filled calculator on your website." };
const updater = createUpdateManager({
  app,
  autoUpdater,
  report: updateStatus,
  isIdle: () => activeSessions.size === 0 && activeJobs === 0
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith("ofc://"));
    if (link) void receiveLink(link);
    statusWindow?.show();
    statusWindow?.focus();
  });

  app.on("open-url", (event, link) => {
    event.preventDefault();
    void receiveLink(link);
  });

  app.on("window-all-closed", () => {
    if (activeSessions.size === 0 && activeJobs === 0 && !updater.installIfIdle()) app.quit();
  });

  app.whenReady().then(async () => {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("ofc", process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient("ofc");
    }
    createStatusWindow();
    const settings = await readFile(settingsPath(), "utf8").then(JSON.parse).catch(() => ({}));
    if (typeof settings.trustedOrigin === "string") {
      void updater.check(settings.trustedOrigin).catch((error) => console.error("Companion update check failed:", error));
    }
    setInterval(async () => {
      const current = await readFile(settingsPath(), "utf8").then(JSON.parse).catch(() => ({}));
      if (typeof current.trustedOrigin === "string") {
        void updater.check(current.trustedOrigin).catch((error) => console.error("Companion update check failed:", error));
      }
    }, 6 * 60 * 60 * 1000).unref();
    const initialLink = process.argv.find((arg) => arg.startsWith("ofc://"));
    if (initialLink) pendingLinks.push(initialLink);
    while (pendingLinks.length) await handleLink(pendingLinks.shift());
  }).catch((error) => showError(error));
}

function createStatusWindow() {
  statusWindow = new BrowserWindow({
    width: 510,
    height: 300,
    minWidth: 450,
    minHeight: 260,
    title: "Open Filled Calculator",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });
  statusWindow.setMenuBarVisibility(false);
  statusWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  statusWindow.loadFile(path.join(__dirname, "status.html"));
  statusWindow.on("closed", () => { statusWindow = undefined; });
  ipcMain.handle("ofc:status", () => currentStatus);
  ipcMain.handle("ofc:reset-website", async () => {
    await writeFile(settingsPath(), JSON.stringify({}), { mode: 0o600 });
    updateStatus("Website reset", "The next OFC click will ask you to trust its website.");
  });
}

async function receiveLink(link) {
  if (!app.isReady()) {
    pendingLinks.push(link);
    return;
  }
  await handleLink(link);
}

async function handleLink(link) {
  activeJobs += 1;
  try {
    const { ticket, serverUrl } = parseLink(link);
    const trusted = await trustedWebsite(serverUrl);
    if (!trusted) {
      updateStatus("Cancelled", "Website access was not approved.");
      return;
    }
    updateStatus("Opening Chrome", "Fetching the mapped case and filling the lender calculator...");
    void updater.check(serverUrl).catch((error) => console.error("Companion update check failed:", error));
    const { openFilledCalculator } = await import(pathToFileURL(path.join(__dirname, "dist", "companion.js")).href);
    let session;
    session = await openFilledCalculator(serverUrl, ticket, () => {
      if (session) activeSessions.delete(session);
      updateStatus("Chrome closed", "Click Open filled calculator on your website to start another session.");
      if (!updater.installIfIdle() && !statusWindow && activeSessions.size === 0 && activeJobs === 0) app.quit();
    });
    activeSessions.add(session);
    updateStatus(session.status === "ready" ? "Calculator ready" : "Some fields need attention", session.message);
  } catch (error) {
    if (error?.code === "OFC_ADAPTER_MISMATCH") {
      updateStatus("Adapter update needed", error.message);
      try {
        const state = await updater.check(parseLink(link).serverUrl, true);
        if (!state.configured) {
          updateStatus("Companion update unavailable", "No update feed is configured. Ask the website administrator for the latest companion installer, then click OFC again.");
        } else if (!state.available && !state.downloaded) {
          updateStatus("Companion update not published", "The website has newer adapter code, but no matching companion update is published yet. Ask the website administrator to release it.");
        }
      } catch (updateError) {
        updateStatus("Companion update failed", updateError instanceof Error ? updateError.message : String(updateError));
      }
    } else {
      showError(error);
    }
  } finally {
    activeJobs -= 1;
    if (!updater.installIfIdle() && !statusWindow && activeSessions.size === 0 && activeJobs === 0) app.quit();
  }
}

async function trustedWebsite(serverUrl) {
  const settings = await readFile(settingsPath(), "utf8").then(JSON.parse).catch(() => ({}));
  if (settings.trustedOrigin === serverUrl) return true;
  if (settings.trustedOrigin) {
    throw new Error(`This companion is linked to ${settings.trustedOrigin}. Use Change website in the companion before opening ${serverUrl}.`);
  }
  const options = {
    type: "question",
    buttons: ["Allow", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Connect to your website",
    message: `Allow Open Filled Calculator to receive cases from ${serverUrl}?`,
    detail: "This choice is saved on this computer. Only this website can send cases to the companion."
  };
  const answer = statusWindow ? await dialog.showMessageBox(statusWindow, options) : await dialog.showMessageBox(options);
  if (answer.response !== 0) return false;
  await writeFile(settingsPath(), JSON.stringify({ trustedOrigin: serverUrl }), { mode: 0o600 });
  return true;
}

function settingsPath() {
  return path.join(app.getPath("userData"), "ofc-settings.json");
}

function updateStatus(title, detail) {
  currentStatus = { title, detail };
  statusWindow?.webContents.send("ofc:status", currentStatus);
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  updateStatus("Unable to open calculator", message);
  dialog.showErrorBox("Open Filled Calculator", message);
}
