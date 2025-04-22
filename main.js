require("dotenv").config();
const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.loadFile("index.html");

  // Create Chrome-like application menu
  const template = [
    {
      label: "File",
      submenu: [{ role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            await shell.openExternal("https://electronjs.org");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handle webview actions from renderer
ipcMain.handle("webview-action", async (event, action, data) => {
  switch (action) {
    case "toggle-devtools":
      mainWindow.webContents.send("toggle-webview-devtools");
      return { status: "ok" };
    case "clear-cache":
      await mainWindow.webContents.session.clearCache();
      return { status: "ok", message: "Browser cache cleared" };
    case "clear-cookies":
      await mainWindow.webContents.session.clearStorageData({
        storages: ["cookies"],
      });
      return { status: "ok", message: "Cookies cleared" };
    default:
      return { status: "error", message: "Unknown action" };
  }
});

const LOG_PATH = path.join(app.getPath("userData"), "actions.log");

ipcMain.handle("execute-command", async (event, command) => {
  try {
    console.log("Received command from renderer:", command);
    const systemPrompt = `You are an AI browser automation agent. Receive a natural language command and output a JSON array of steps. Each step has 'action', 'selector', and optional 'value' or 'url'. Allowed actions: click, type, scroll, navigate.`;
    const chat = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command },
      ],
      max_tokens: 500,
    });
    const content = chat.choices[0].message.content;
    let plan;
    try {
      // Extract JSON if it's wrapped in markdown code blocks
      const jsonContent = content.replace(/```json\n|\n```/g, "").trim();
      plan = JSON.parse(jsonContent);
    } catch (err) {
      throw new Error(
        "Failed to parse plan JSON: " + err.message + ". Content: " + content
      );
    }
    event.sender.send("plan-update", plan);
    return { status: "ok", plan };
  } catch (err) {
    console.error("Error executing command:", err);
    return { status: "error", error: err.message };
  }
});

ipcMain.on("log-action", (event, record) => {
  const redacted = { ...record };
  if (
    record.action === "type" &&
    record.selector.toLowerCase().includes("password")
  ) {
    redacted.value = "REDACTED";
  }
  const entry = { ...redacted, timestamp: new Date().toISOString() };
  fs.appendFile(LOG_PATH, JSON.stringify(entry) + "\n", (err) => {
    if (err) console.error("Failed to log action:", err);
  });
});
