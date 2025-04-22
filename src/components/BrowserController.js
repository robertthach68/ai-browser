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

  /**
   * Set up navigation controls
   */
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

    // Insert into prompt bar
    const promptBar = document.getElementById("prompt-bar");
    if (promptBar) {
      promptBar.insertBefore(
        this.navControls,
        document.getElementById("command-input")
      );
    }
  }

  /**
   * Set up event listeners for the webview
   */
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

  /**
   * Navigate to a URL
   * @param {string} url - The URL to navigate to
   * @returns {Promise<void>}
   */
  async navigate(url) {
    return new Promise((resolve, reject) => {
      // Use addEventListener instead of once
      const loadHandler = () => {
        this.webview.removeEventListener("did-finish-load", loadHandler);
        resolve();
      };

      const failHandler = (event) => {
        this.webview.removeEventListener("did-fail-load", failHandler);
        reject(
          new Error(
            `Failed to load URL: ${url}, error code: ${event.errorCode}`
          )
        );
      };

      this.webview.addEventListener("did-finish-load", loadHandler);
      this.webview.addEventListener("did-fail-load", failHandler);

      this.webview.loadURL(url);

      // Add timeout to prevent hanging forever
      setTimeout(() => {
        this.webview.removeEventListener("did-finish-load", loadHandler);
        this.webview.removeEventListener("did-fail-load", failHandler);
        resolve(); // Resolve anyway to avoid hanging
      }, 10000);
    });
  }

  /**
   * Go back in browser history
   */
  goBack() {
    if (this.webview.canGoBack()) {
      this.webview.goBack();
    }
  }

  /**
   * Go forward in browser history
   */
  goForward() {
    if (this.webview.canGoForward()) {
      this.webview.goForward();
    }
  }

  /**
   * Refresh the current page
   */
  refresh() {
    this.webview.reload();
  }

  /**
   * Update the navigation buttons based on history state
   */
  updateNavigationState() {
    if (this.backBtn) {
      this.backBtn.disabled = !this.webview.canGoBack();
    }
    if (this.forwardBtn) {
      this.forwardBtn.disabled = !this.webview.canGoForward();
    }
  }

  /**
   * Update the URL display with the current URL
   */
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

  /**
   * Get the current URL
   * @returns {Promise<string>} The current URL
   */
  async getCurrentUrl() {
    return await this.webview.getURL();
  }

  /**
   * Get the current page title
   * @returns {Promise<string>} The current page title
   */
  async getCurrentTitle() {
    return await this.webview.getTitle();
  }

  /**
   * Open developer tools for the webview
   */
  openDevTools() {
    this.webview.openDevTools();
  }
}

module.exports = BrowserController;
