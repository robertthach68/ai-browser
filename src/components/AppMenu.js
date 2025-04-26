const { Menu, shell } = require("electron");

class AppMenu {
  /**
   * Create and set the application menu
   * @param {BrowserWindow} mainWindow - The main application window
   */
  static createMenu(mainWindow) {
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
        label: "Browser",
        submenu: [
          {
            label: "Clear Cache",
            click: async () => {
              await mainWindow.webContents.session.clearCache();
              mainWindow.webContents.send("browser-action", {
                action: "clear-cache",
                status: "ok",
                message: "Browser cache cleared",
              });
            },
          },
          {
            label: "Clear Cookies",
            click: async () => {
              await mainWindow.webContents.session.clearStorageData({
                storages: ["cookies"],
              });
              mainWindow.webContents.send("browser-action", {
                action: "clear-cookies",
                status: "ok",
                message: "Cookies cleared",
              });
            },
          },
          { type: "separator" },
          {
            label: "Toggle Webview DevTools",
            click: () => {
              mainWindow.webContents.send("toggle-webview-devtools");
            },
          },
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
}

module.exports = AppMenu;
 