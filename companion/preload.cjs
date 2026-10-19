const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ofc", {
  status: () => ipcRenderer.invoke("ofc:status"),
  resetWebsite: () => ipcRenderer.invoke("ofc:reset-website"),
  onStatus: (callback) => ipcRenderer.on("ofc:status", (_event, status) => callback(status))
});
