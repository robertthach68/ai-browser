const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiBrowser", {
  executeCommand: (command) => ipcRenderer.invoke("execute-command", command),
  onPlanUpdate: (callback) =>
    ipcRenderer.on("plan-update", (event, plan) => callback(plan)),
  logAction: (record) => ipcRenderer.send("log-action", record),
});
