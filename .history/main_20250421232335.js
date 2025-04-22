require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { Configuration, OpenAIApi } = require("openai");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });
  win.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);
const LOG_PATH = path.join(app.getPath("userData"), "actions.log");

ipcMain.handle("execute-command", async (event, command) => {
  try {
    console.log("Received command from renderer:", command);
    const systemPrompt = `You are an AI browser automation agent. Receive a natural language command and output a JSON array of steps. Each step has 'action', 'selector', and optional 'value' or 'url'. Allowed actions: click, type, scroll, navigate.`;
    const chat = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command },
      ],
      max_tokens: 500,
    });
    const content = chat.data.choices[0].message.content;
    let plan;
    try {
      plan = JSON.parse(content);
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
