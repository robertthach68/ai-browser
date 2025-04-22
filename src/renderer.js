// Import client-side components
// Note: Since this is running in the renderer process without Node.js integration,
// we need to implement these components here directly rather than importing.

/**
 * Main application class that coordinates all browser functionality
 */
class App {
  constructor() {
    // Core elements
    this.webview = document.getElementById("webview");
    this.commandInput = document.getElementById("command-input");
    this.executeBtn = document.getElementById("execute-btn");
    this.statusSpan = document.getElementById("status");

    // Initialize components
    this.browserController = new BrowserController(this.webview);
    this.planExecutor = new PlanExecutor(this.webview, this.statusSpan, this);
    this.setupUIEventListeners();
    this.setupIPCListeners();
  }

  /**
   * Set up UI event listeners
   */
  setupUIEventListeners() {
    // Execute button click
    this.executeBtn.addEventListener("click", async () => {
      const command = this.commandInput.value.trim();
      if (!command) return;

      this.commandInput.disabled = true;
      this.executeBtn.disabled = true;
      this.statusSpan.innerText = "Planning...";

      try {
        const resp = await window.aiBrowser.executeCommand(command);
        if (resp.status !== "ok") {
          throw new Error(resp.error || "Unknown error");
        }

        const plan = resp.plan;
        this.statusSpan.innerText = "Plan ready";

        const runAI = confirm("Run AI actions? Cancel to manual.");
        if (runAI) {
          await this.planExecutor.executePlan(plan);
          this.statusSpan.innerText = "Done";
        } else {
          this.statusSpan.innerText = "Manual mode";
        }
      } catch (err) {
        console.error(err);
        this.statusSpan.innerText = "Error: " + err.message;
      } finally {
        this.commandInput.disabled = false;
        this.executeBtn.disabled = false;
      }
    });

    // Add keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Only handle when webview is not focused
      if (document.activeElement === this.webview) return;

      // Ctrl+R or F5 to refresh
      if ((e.ctrlKey && e.key === "r") || e.key === "F5") {
        this.browserController.refresh();
      }

      // Alt+Left to go back
      if (e.altKey && e.key === "ArrowLeft") {
        this.browserController.goBack();
      }

      // Alt+Right to go forward
      if (e.altKey && e.key === "ArrowRight") {
        this.browserController.goForward();
      }

      // Ctrl+L to focus URL input
      if (e.ctrlKey && e.key === "l") {
        this.createTemporaryUrlInput();
      }
    });
  }

  /**
   * Set up IPC listeners for main process communication
   */
  setupIPCListeners() {
    // Listen for plan updates
    window.aiBrowser.onPlanUpdate((plan) => {
      console.log("Received plan update:", plan);
    });

    // Listen for browser actions
    window.aiBrowser.onBrowserAction((data) => {
      console.log("Browser action:", data);
      if (data.message) {
        this.statusSpan.innerText = data.message;
        setTimeout(() => {
          this.statusSpan.innerText = "";
        }, 3000);
      }
    });

    // Listen for webview DevTools toggle
    window.aiBrowser.onWebviewDevTools(() => {
      this.webview.isDevToolsOpened()
        ? this.webview.closeDevTools()
        : this.webview.openDevTools();
    });

    // Listen for page snapshot requests
    window.aiBrowser.onGetPageSnapshot(async () => {
      try {
        const url = await this.webview.getURL();
        const title = await this.webview.getTitle();

        // Get page content via JavaScript execution in the webview
        const content = await this.webview.executeJavaScript(`
          (() => {
            return {
              html: document.documentElement.outerHTML,
              text: document.body.innerText.substring(0, 5000),
              links: Array.from(document.links).map(link => ({
                text: link.innerText,
                href: link.href
              })).slice(0, 50),
              inputs: Array.from(document.querySelectorAll('input, textarea')).map(input => ({
                type: input.type,
                id: input.id,
                name: input.name,
                placeholder: input.placeholder
              }))
            };
          })();
        `);

        const pageData = { url, title, content };
        await window.aiBrowser.sendPageSnapshot(pageData);
      } catch (error) {
        console.error("Error capturing page snapshot:", error);
      }
    });
  }

  /**
   * Create a temporary URL input for navigation
   */
  createTemporaryUrlInput() {
    this.webview.getURL().then((url) => {
      // Create a temporary input for URL editing
      const tempInput = document.createElement("input");
      tempInput.type = "text";
      tempInput.value = url;
      tempInput.style.position = "fixed";
      tempInput.style.top = "0";
      tempInput.style.left = "0";
      tempInput.style.width = "100%";
      tempInput.style.height = "30px";
      tempInput.style.zIndex = "2000";

      document.body.appendChild(tempInput);
      tempInput.select();

      tempInput.addEventListener("keydown", (ke) => {
        if (ke.key === "Enter") {
          this.browserController.navigate(tempInput.value);
          tempInput.remove();
          ke.preventDefault();
        } else if (ke.key === "Escape") {
          tempInput.remove();
          ke.preventDefault();
        }
      });

      tempInput.addEventListener("blur", () => {
        tempInput.remove();
      });
    });
  }

  /**
   * Log an action through the IPC
   * @param {Object} record - The action record to log
   */
  logAction(record) {
    window.aiBrowser.logAction(record);
  }
}

/**
 * Browser controller class for navigation and URL display
 */
class BrowserController {
  constructor(webview) {
    this.webview = webview;
    this.navControls = null;
    this.backBtn = null;
    this.forwardBtn = null;
    this.refreshBtn = null;
    this.urlDisplay = null;

    this.setupNavControls();
    this.setupEventListeners();
  }

  setupNavControls() {
    // Create navigation controls container
    this.navControls = document.createElement("div");
    this.navControls.id = "nav-controls";
    Object.assign(this.navControls.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "0 10px",
    });

    // Back button
    this.backBtn = document.createElement("button");
    this.backBtn.innerHTML = "&#8592;"; // Left arrow
    this.backBtn.title = "Go Back";
    this.backBtn.onclick = () => this.goBack();

    // Forward button
    this.forwardBtn = document.createElement("button");
    this.forwardBtn.innerHTML = "&#8594;"; // Right arrow
    this.forwardBtn.title = "Go Forward";
    this.forwardBtn.onclick = () => this.goForward();

    // Refresh button
    this.refreshBtn = document.createElement("button");
    this.refreshBtn.innerHTML = "&#8635;"; // Reload symbol
    this.refreshBtn.title = "Refresh";
    this.refreshBtn.onclick = () => this.refresh();

    // URL display
    this.urlDisplay = document.createElement("span");
    this.urlDisplay.id = "url-display";
    Object.assign(this.urlDisplay.style, {
      marginLeft: "10px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      flex: "1",
    });

    // Assemble the navigation controls
    this.navControls.appendChild(this.backBtn);
    this.navControls.appendChild(this.forwardBtn);
    this.navControls.appendChild(this.refreshBtn);
    this.navControls.appendChild(this.urlDisplay);

    // Add the menu button
    this.setupMenuButton();

    // Insert into prompt bar
    const promptBar = document.getElementById("prompt-bar");
    if (promptBar) {
      promptBar.insertBefore(
        this.navControls,
        document.getElementById("command-input")
      );
    }
  }

  setupMenuButton() {
    // Add DevTools toggle
    const devToolsBtn = document.createElement("button");
    devToolsBtn.innerHTML = "⋮"; // Three dots menu
    devToolsBtn.title = "Menu";
    devToolsBtn.id = "menu-btn";
    Object.assign(devToolsBtn.style, {
      marginLeft: "5px",
    });

    const menuDropdown = document.createElement("div");
    menuDropdown.id = "menu-dropdown";
    Object.assign(menuDropdown.style, {
      position: "absolute",
      top: "40px",
      right: "10px",
      backgroundColor: "#fff",
      boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
      borderRadius: "4px",
      display: "none",
      zIndex: "1001",
    });

    const menuItems = [
      { text: "Open DevTools", action: () => this.webview.openDevTools() },
      {
        text: "Clear Cache",
        action: () => window.aiBrowser.webviewAction("clear-cache"),
      },
      {
        text: "Clear Cookies",
        action: () => window.aiBrowser.webviewAction("clear-cookies"),
      },
      {
        text: "View Page Source",
        action: () =>
          this.webview.executeJavaScript("window.location.href").then((url) => {
            const sourceUrl = "view-source:" + url;
            window.open(sourceUrl, "_blank");
          }),
      },
      { text: "Print Page", action: () => this.webview.print() },
    ];

    menuItems.forEach((item) => {
      const menuItem = document.createElement("div");
      menuItem.className = "menu-item";
      menuItem.textContent = item.text;
      Object.assign(menuItem.style, {
        padding: "8px 16px",
        cursor: "pointer",
      });
      menuItem.addEventListener("click", () => {
        item.action();
        menuDropdown.style.display = "none";
      });
      menuItem.addEventListener("mouseover", () => {
        menuItem.style.backgroundColor = "#f1f1f1";
      });
      menuItem.addEventListener("mouseout", () => {
        menuItem.style.backgroundColor = "";
      });
      menuDropdown.appendChild(menuItem);
    });

    // Toggle menu dropdown
    devToolsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (
        menuDropdown.style.display === "none" ||
        !menuDropdown.style.display
      ) {
        menuDropdown.style.display = "block";
      } else {
        menuDropdown.style.display = "none";
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
      menuDropdown.style.display = "none";
    });

    this.navControls.appendChild(devToolsBtn);
    document.body.appendChild(menuDropdown);
  }

  setupEventListeners() {
    if (!this.webview) return;

    // Update URL display when loading a new page
    this.webview.addEventListener("did-start-loading", () => {
      this.urlDisplay.textContent = "Loading...";
    });

    this.webview.addEventListener("did-finish-load", () => {
      this.updateUrlDisplay();
    });

    this.webview.addEventListener("page-title-updated", (e) => {
      document.title = e.title + " - AI Browser";
    });

    // Update navigation button states
    this.webview.addEventListener("did-navigate", () => {
      this.updateNavigationState();
      this.updateUrlDisplay();
    });
  }

  navigate(url) {
    this.webview.loadURL(url);
  }

  goBack() {
    if (this.webview.canGoBack()) {
      this.webview.goBack();
    }
  }

  goForward() {
    if (this.webview.canGoForward()) {
      this.webview.goForward();
    }
  }

  refresh() {
    this.webview.reload();
  }

  updateNavigationState() {
    if (this.backBtn) {
      this.backBtn.disabled = !this.webview.canGoBack();
    }
    if (this.forwardBtn) {
      this.forwardBtn.disabled = !this.webview.canGoForward();
    }
  }

  async updateUrlDisplay() {
    if (this.urlDisplay) {
      try {
        const url = await this.webview.getURL();
        this.urlDisplay.textContent = url;
      } catch (error) {
        console.error("Error getting URL:", error);
      }
    }
  }
}

/**
 * Plan executor for running AI-generated action plans
 */
class PlanExecutor {
  constructor(webview, statusElement, logger) {
    this.webview = webview;
    this.statusElement = statusElement;
    this.logger = logger;
  }

  async executePlan(plan) {
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      const { action, selector, value, url } = step;

      this.updateStatus(`Executing ${action} (${i + 1}/${plan.length})`);

      try {
        await this.executeStep(step);

        this.logger.logAction({
          action,
          selector,
          value,
          url,
          status: "success",
        });
      } catch (e) {
        this.logger.logAction({
          action,
          selector,
          value,
          url,
          status: "error",
          error: e.message,
        });

        this.showFallback(e.message);
        break;
      }
    }

    this.updateStatus("Plan execution completed");
  }

  async executeStep(step) {
    const { action, selector, value, url } = step;

    switch (action) {
      case "navigate":
        await new Promise((resolve, reject) => {
          this.webview.loadURL(url);
          this.webview.once("did-finish-load", resolve);
          this.webview.once("did-fail-load", () =>
            reject(new Error("Failed to load " + url))
          );
        });
        break;

      case "click":
        await this.webview.executeJavaScript(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error('Element not found: ' + ${JSON.stringify(
              selector
            )});
            el.click();
            return true;
          })();
        `);
        break;

      case "type":
        await this.webview.executeJavaScript(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error('Element not found: ' + ${JSON.stringify(
              selector
            )});
            el.focus();
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })();
        `);
        break;

      case "scroll":
        await this.webview.executeJavaScript(`
          (() => {
            const el = ${
              step.selector
                ? `document.querySelector(${JSON.stringify(selector)})`
                : "document.scrollingElement"
            };
            if (!el) throw new Error('Element not found: ' + ${JSON.stringify(
              selector
            )});
            el.scrollBy(0, ${value});
            return true;
          })();
        `);
        break;

      default:
        throw new Error("Unknown action: " + action);
    }
  }

  updateStatus(message) {
    if (this.statusElement) {
      this.statusElement.innerText = message;
    }
  }

  showFallback(message) {
    const overlay = document.createElement("div");
    overlay.id = "fallback-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "10000",
    });

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
      background: "#fff",
      padding: "20px",
      borderRadius: "8px",
      textAlign: "center",
    });

    const msg = document.createElement("p");
    msg.innerText = "AI automation failed: " + message + "\nClick it yourself!";

    const btn = document.createElement("button");
    btn.innerText = "I'll do it";
    btn.addEventListener("click", () => {
      overlay.remove();
      this.updateStatus("Fallback to manual");
    });

    dialog.appendChild(msg);
    dialog.appendChild(btn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }
}

// Initialize the app when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.app = new App();
});
