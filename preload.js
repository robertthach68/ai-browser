const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiBrowser", {
  // Command execution and plan handling
  executeCommand: (command) => ipcRenderer.invoke("execute-command", command),
  onPlanUpdate: (callback) =>
    ipcRenderer.on("plan-update", (event, plan) => callback(plan)),
  // Multi-step command execution events
  onCommandSatisfied: (callback) =>
    ipcRenderer.on("command-satisfied", (event, data) => callback(data)),
  onCommandMaxSteps: (callback) =>
    ipcRenderer.on("command-max-steps", (event, data) => callback(data)),

  // Page snapshot functionality
  onGetPageSnapshot: (callback) =>
    ipcRenderer.on("get-page-snapshot", () => callback()),
  sendPageSnapshot: (pageData) =>
    ipcRenderer.invoke("page-snapshot-result", pageData),

  // File operations
  saveFile: (filename, data) => ipcRenderer.invoke("save-file", filename, data),

  // Accessibility features
  explainPage: () => ipcRenderer.invoke("explain-page"),

  // Speech transcription
  transcribeAudio: (audioBase64) =>
    ipcRenderer.invoke("transcribe-audio", audioBase64),

  // Logging
  logAction: (record) => ipcRenderer.send("log-action", record),

  // Browser functionality
  webviewAction: (action, data) =>
    ipcRenderer.invoke("webview-action", action, data),
  onWebviewDevTools: (callback) =>
    ipcRenderer.on("toggle-webview-devtools", () => callback()),
  onBrowserAction: (callback) =>
    ipcRenderer.on("browser-action", (event, data) => callback(data)),

  // Global shortcut events
  onVoicePromptTriggered: (callback) =>
    ipcRenderer.on("trigger-voice-prompt", () => callback()),
  onDescribePageTriggered: (callback) =>
    ipcRenderer.on("trigger-describe-page", () => callback()),
});
