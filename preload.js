const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiBrowser", {
  executeCommand: (command) => ipcRenderer.invoke("execute-command", command),
  onPlanUpdate: (callback) =>
    ipcRenderer.on("plan-update", (event, plan) => callback(plan)),
  logAction: (record) => ipcRenderer.send("log-action", record),

  // Add browser functionality
  webviewAction: (action, data) =>
    ipcRenderer.invoke("webview-action", action, data),
  onWebviewDevTools: (callback) =>
    ipcRenderer.on("toggle-webview-devtools", () => callback()),
});
