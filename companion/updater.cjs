const checkIntervalMs = 6 * 60 * 60 * 1000;

function validFeedUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch {
    return null;
  }
}

function createUpdateManager({ app, autoUpdater, report, isIdle, fetchConfig = fetch }) {
  let configuredOrigin = null;
  let checkPromise = null;
  let lastCheckAt = 0;
  let availableVersion = null;
  let downloadedVersion = null;
  let installing = false;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", (info) => {
    availableVersion = info.version;
    report("Downloading companion update", `Version ${info.version} is downloading in the background.`);
  });
  autoUpdater.on("update-not-available", () => { availableVersion = null; });
  autoUpdater.on("update-downloaded", (info) => {
    downloadedVersion = info.version;
    report("Companion update ready", `Version ${info.version} will install after open Chrome sessions finish.`);
    installIfIdle();
  });
  autoUpdater.on("error", (error) => {
    report("Companion update failed", error instanceof Error ? error.message : String(error));
  });

  async function configure(serverUrl) {
    if (!app.isPackaged) return false;
    const response = await fetchConfig(new URL("/api/ofc/config", serverUrl), {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Unable to read companion update settings (${response.status}).`);
    const config = await response.json();
    const feedUrl = validFeedUrl(config.updateFeedUrl);
    if (!feedUrl) {
      configuredOrigin = null;
      return false;
    }
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
    configuredOrigin = serverUrl;
    return true;
  }

  async function check(serverUrl, force = false) {
    if (checkPromise) return checkPromise;
    if (!force && configuredOrigin === serverUrl && Date.now() - lastCheckAt < checkIntervalMs) {
      return { configured: true, available: !!availableVersion, downloaded: !!downloadedVersion };
    }
    checkPromise = (async () => {
      const configured = await configure(serverUrl);
      if (!configured) return { configured: false, available: false, downloaded: false };
      await autoUpdater.checkForUpdates();
      lastCheckAt = Date.now();
      return { configured: true, available: !!availableVersion, downloaded: !!downloadedVersion };
    })().finally(() => { checkPromise = null; });
    return checkPromise;
  }

  function installIfIdle() {
    if (!downloadedVersion || installing || !isIdle()) return false;
    installing = true;
    report("Installing companion update", `Version ${downloadedVersion} is installing. The companion will restart.`);
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(true, true);
      } catch (error) {
        installing = false;
        report("Companion update failed", error instanceof Error ? error.message : String(error));
      }
    });
    return true;
  }

  return { check, installIfIdle, validFeedUrl };
}

module.exports = { createUpdateManager, validFeedUrl };
