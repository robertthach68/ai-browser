require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Import our classes
const AIConnector = require("./services/AIConnector");
const Logger = require("./utils/Logger");
const AppMenu = require("./components/AppMenu");

// Global variables
let mainWindow;
let aiConnector;
let logger;
let pendingPageSnapshotPromises = {};

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  // Create and set the application menu
  AppMenu.createMenu(mainWindow);
}

/**
 * Initialize the application
 */
function initialize() {
  // Create our service instances
  aiConnector = new AIConnector(process.env.OPENAI_API_KEY);
  logger = new Logger();

  // Set up IPC handlers
  setupIpcHandlers();
}

/**
 * Set up IPC handlers for renderer communication
 */
function setupIpcHandlers() {
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

  // Handle execute command
  ipcMain.handle("execute-command", async (event, command) => {
    try {
      console.log("Received command from renderer:", command);

      // Create a promise to get the page data
      let plan;

      // Simple direct handling for navigation commands
      if (command.toLowerCase().includes("go to")) {
        plan = await aiConnector.generatePlan(command, {});
      } else {
        // For more complex commands, we need page data
        try {
          const pageData = await getPageSnapshot(event.sender.id);
          console.log("Page data:", pageData);
          plan = await aiConnector.generatePlan(command, pageData);
        } catch (error) {
          console.log("Could not get page data, using fallback:", error);
          plan = await aiConnector.generatePlan(command, {});
        }
      }

      event.sender.send("plan-update", plan);
      return { status: "ok", plan };
    } catch (err) {
      console.error("Error executing command:", err);
      return { status: "error", error: err.message };
    }
  });

  // Handle page snapshot result from renderer
  ipcMain.handle("page-snapshot-result", async (event, pageData) => {
    const senderId = event.sender.id;

    // If there's a pending promise for this sender, resolve it
    if (pendingPageSnapshotPromises[senderId]) {
      pendingPageSnapshotPromises[senderId].resolve(pageData);
      delete pendingPageSnapshotPromises[senderId];
    }

    return { status: "ok" };
  });

  // Handle logging actions
  ipcMain.on("log-action", (event, record) => {
    logger.logAction(record);
  });
}

/**
 * Get a page snapshot from the renderer
 * @param {number} senderId - The ID of the sender WebContents
 * @returns {Promise<Object>} The page snapshot data
 */
function getPageSnapshot(senderId) {
  return new Promise((resolve, reject) => {
    // Store the promise callbacks for later resolution
    pendingPageSnapshotPromises[senderId] = { resolve, reject };

    // Request the renderer to send a page snapshot
    mainWindow.webContents.send("get-page-snapshot");

    // Set a timeout in case the renderer doesn't respond
    setTimeout(() => {
      if (pendingPageSnapshotPromises[senderId]) {
        reject(new Error("Timeout waiting for page snapshot"));
        delete pendingPageSnapshotPromises[senderId];
      }
    }, 5000);
  });
}

// Application lifecycle events
app.whenReady().then(() => {
  initialize();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
