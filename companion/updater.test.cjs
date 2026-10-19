const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { createUpdateManager, validFeedUrl } = require("./updater.cjs");

test("update feed must be HTTPS without credentials", () => {
  assert.equal(validFeedUrl("http://updates.example.com/ofc"), null);
  assert.equal(validFeedUrl("https://user:pass@updates.example.com/ofc"), null);
  assert.equal(validFeedUrl("https://updates.example.com/ofc?token=secret"), null);
  assert.equal(validFeedUrl("https://updates.example.com/ofc"), "https://updates.example.com/ofc/");
});

test("downloaded update waits for Chrome sessions to close", async () => {
  const autoUpdater = new EventEmitter();
  const installed = [];
  let idle = false;
  autoUpdater.setFeedURL = (value) => { autoUpdater.feed = value; };
  autoUpdater.checkForUpdates = async () => {
    autoUpdater.emit("update-available", { version: "0.2.0" });
    return {};
  };
  autoUpdater.quitAndInstall = (...args) => { installed.push(args); };
  const manager = createUpdateManager({
    app: { isPackaged: true },
    autoUpdater,
    report: () => {},
    isIdle: () => idle,
    fetchConfig: async () => ({ ok: true, json: async () => ({ updateFeedUrl: "https://updates.example.com/ofc" }) })
  });

  assert.equal((await manager.check("https://calculator.example.com")).available, true);
  assert.equal(autoUpdater.feed.url, "https://updates.example.com/ofc/");
  autoUpdater.emit("update-downloaded", { version: "0.2.0" });
  assert.equal(manager.installIfIdle(), false);
  idle = true;
  assert.equal(manager.installIfIdle(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(installed, [[true, true]]);
  assert.equal(manager.installIfIdle(), false);
});

test("missing update feed disables checks", async () => {
  const autoUpdater = new EventEmitter();
  autoUpdater.setFeedURL = () => { throw new Error("unexpected feed"); };
  autoUpdater.checkForUpdates = () => { throw new Error("unexpected check"); };
  const manager = createUpdateManager({
    app: { isPackaged: true }, autoUpdater, report: () => {}, isIdle: () => true,
    fetchConfig: async () => ({ ok: true, json: async () => ({ updateFeedUrl: null }) })
  });
  assert.equal((await manager.check("https://calculator.example.com")).configured, false);
});
