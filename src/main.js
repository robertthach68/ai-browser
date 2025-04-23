require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Import our classes
const AIConnector = require("./services/AIConnector");
const AIPageReader = require("./services/AIPageReader");
const Logger = require("./utils/Logger");
const AppMenu = require("./components/AppMenu");

// Global variables
let mainWindow;
let aiConnector;
let aiPageReader;
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
  aiPageReader = new AIPageReader(process.env.OPENAI_API_KEY);
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
      let action;
      let pageData = {};

      // Simple direct handling for navigation commands
      if (command.toLowerCase().includes("go to")) {
        action = await aiConnector.generatePlan(command, {});
      } else {
        // For more complex commands, we need page data
        try {
          pageData = await getPageSnapshot(event.sender.id);
          console.log("Page data:", pageData);
          action = await aiConnector.generatePlan(command, pageData);
        } catch (error) {
          console.log("Could not get page data, using fallback:", error);
          action = await aiConnector.generatePlan(command, {});
        }
      }

      event.sender.send("plan-update", action);
      return { status: "ok", action, command, pageSnapshot: pageData };
    } catch (err) {
      console.error("Error executing command:", err);
      return { status: "error", error: err.message };
    }
  });

  // Handle page snapshot result from renderer
  ipcMain.handle("page-snapshot-result", async (event, pageData) => {
    const senderId = event.sender.id;
    console.log(
      "Received page snapshot from renderer",
      pageData ? `with URL: ${pageData.url || "none"}` : "with no data"
    );

    // If there's a pending promise for this sender, resolve it
    if (pendingPageSnapshotPromises[senderId]) {
      pendingPageSnapshotPromises[senderId].resolve(pageData || {});
      delete pendingPageSnapshotPromises[senderId];
    }

    return { status: "ok" };
  });

  // Handle file saving
  ipcMain.handle("save-file", async (event, filename, data) => {
    try {
      // Ensure the filename is safe
      const sanitizedFilename = path.basename(filename);

      // Save to the snapshots directory
      const snapshotsDir = path.join(process.cwd(), "snapshots");

      // Create snapshots directory if it doesn't exist
      if (!fs.existsSync(snapshotsDir)) {
        fs.mkdirSync(snapshotsDir, { recursive: true });
      }

      const filePath = path.join(snapshotsDir, sanitizedFilename);

      // Write the file to disk
      fs.writeFileSync(filePath, data, "utf8");
      console.log(`File saved: ${filePath}`);

      return {
        status: "ok",
        message: `File saved: ${sanitizedFilename}`,
        path: filePath,
      };
    } catch (error) {
      console.error("Error saving file:", error);
      return {
        status: "error",
        error: error.message,
      };
    }
  });

  // Handle explain page request
  ipcMain.handle("explain-page", async (event) => {
    try {
      console.log("Received explain page request");

      // Fetch the current page snapshot
      const pageData = await getPageSnapshot(event.sender.id);

      // Generate explanation using AIPageReader
      const explanation = await aiPageReader.explainPage(pageData);

      console.log("Generated page explanation successfully");

      return {
        status: "ok",
        explanation,
      };
    } catch (error) {
      console.error("Error explaining page:", error);
      return {
        status: "error",
        error: error.message,
      };
    }
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
    console.log("Getting page snapshot from renderer", senderId);
    try {
      // Request the renderer to send a page snapshot
      mainWindow.webContents.send("get-page-snapshot");

      // Set a timeout in case the renderer doesn't respond
      setTimeout(() => {
        if (pendingPageSnapshotPromises[senderId]) {
          console.log("Timeout waiting for page snapshot, using fallback");
          // Resolve with an empty object rather than rejecting
          // This ensures the command will still work even if snapshot fails
          resolve({});
          delete pendingPageSnapshotPromises[senderId];
        }
      }, 5000);
    } catch (error) {
      console.error("Error requesting page snapshot:", error);
      resolve({}); // Resolve with empty object instead of rejecting
    }
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
