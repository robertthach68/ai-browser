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
    // Enable DevTools and console logging for webview
    this.webview.addEventListener("dom-ready", () => {
      // Open DevTools for webview
      this.webview.openDevTools();

      // Listen for console messages
      this.webview.addEventListener("console-message", (e) => {
        console.log(`Webview console [${e.level}]: ${e.message}`);
      });
    });

    // Execute button click
    this.executeBtn.addEventListener("click", async () => {
      const command = this.commandInput.value.trim();
      if (!command) return;

      this.commandInput.disabled = true;
      this.executeBtn.disabled = true;
      this.statusSpan.innerText = "Planning...";

      try {
        console.log("Sending command to main process:", command);
        const resp = await window.aiBrowser.executeCommand(command);
        console.log("Received response from main process:", resp);

        if (resp.status !== "ok") {
          throw new Error(resp.error || "Unknown error");
        }

        if (!resp.action) {
          this.statusSpan.innerText = "No action was returned";
          console.error("No action received in response:", resp);
          return;
        }

        const action = resp.action;
        console.log("Action to execute:", action);
        this.statusSpan.innerText = `Ready to execute: ${action.action}`;

        const runAI = confirm(
          `Execute AI action: "${action.action}"${
            action.selector ? ` on "${action.selector}"` : ""
          }${action.value ? ` with value "${action.value}"` : ""}${
            action.url ? ` to "${action.url}"` : ""
          }? Cancel to skip.`
        );
        if (runAI) {
          console.log("User confirmed execution of action:", action);
          try {
            await this.planExecutor.executePlan(action);
            console.log("Action executed successfully");
            this.statusSpan.innerText = "Action completed. Enter next command.";
          } catch (execError) {
            console.error("Error executing action:", execError);
            this.statusSpan.innerText =
              "Action execution failed: " + execError.message;
          }
        } else {
          console.log("User skipped execution of action:", action);
          this.statusSpan.innerText = "Action skipped. Enter next command.";
        }
      } catch (err) {
        console.error("Error in command execution flow:", err);
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
          (function() {
            try {
              const doc = document;
              
              // Function to extract accessibility information from an element
              function getA11yInfo(el) {
                if (!el) return null;
                
                return {
                  role: el.getAttribute('role') || el.tagName.toLowerCase(),
                  label: el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('alt') || el.getAttribute('title') || '',
                  name: el.getAttribute('name') || el.id || '',
                  disabled: el.getAttribute('aria-disabled') === 'true' || el.disabled || false,
                  pressed: el.getAttribute('aria-pressed') || null,
                  expanded: el.getAttribute('aria-expanded') || null,
                  checked: el.getAttribute('aria-checked') || (el.tagName === 'INPUT' && el.type === 'checkbox' ? el.checked : null),
                  hidden: el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden',
                  required: el.required || el.getAttribute('aria-required') === 'true' || false
                };
              }
              
              // Build a simplified a11y tree - get interactive elements
              const getInteractiveElements = () => {
                const interactiveSelectors = [
                  'a[href]', 'button', 'input', 'textarea', 'select', 
                  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
                  '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="listbox"]',
                  '[role="option"]', '[role="switch"]', '[role="searchbox"]', '[role="textbox"]',
                  '[tabindex]:not([tabindex="-1"])'
                ].join(',');
                
                return Array.from(doc.querySelectorAll(interactiveSelectors) || [])
                  .filter(el => {
                    // Filter out hidden elements
                    return !(el.getAttribute('aria-hidden') === 'true' || 
                           getComputedStyle(el).display === 'none' || 
                           getComputedStyle(el).visibility === 'hidden');
                  })
                  .map(el => {
                    const id = el.id ? '#' + el.id : '';
                    const classes = el.className ? '.' + el.className.replace(/\\s+/g, '.') : '';
                    return {
                      a11y: getA11yInfo(el),
                      selector: id || el.tagName.toLowerCase() + classes,
                      xpath: getXPath(el)
                    };
                  }).slice(0, 50); // Limit to 50 elements to prevent too much data
              };
              
              // Function to get XPath for an element
              function getXPath(element) {
                if (!element) return '';
                if (element.id) return \`//*[@id="\${element.id}"]\`;
                
                let path = '';
                while (element && element.nodeType === Node.ELEMENT_NODE) {
                  let sibling = element;
                  let siblings = [];
                  
                  while (sibling.previousSibling) {
                    const prev = sibling.previousSibling;
                    if (prev.nodeType === Node.ELEMENT_NODE && prev.tagName === element.tagName) {
                      siblings.push(prev);
                    }
                    sibling = prev;
                  }
                  
                  const position = siblings.length > 0 ? siblings.length + 1 : 1;
                  const tagName = element.tagName.toLowerCase();
                  path = \`/\${tagName}[\${position}]\${path ? '/' + path : ''}\`;
                  
                  element = element.parentNode;
                }
                
                return \`/\${path}\`;
              }
              
              return {
                html: doc.documentElement.outerHTML,
                text: doc.body ? doc.body.innerText.substring(0, 5000) : "",
                a11yTree: getInteractiveElements(),
                links: Array.from(doc.links || []).map(link => ({
                  text: link.innerText || link.textContent || "",
                  href: link.href || "",
                  a11y: getA11yInfo(link)
                })).slice(0, 50),
                inputs: Array.from(doc.querySelectorAll('input, textarea') || []).map(input => ({
                  type: input.type || "text",
                  id: input.id || "",
                  name: input.name || "",
                  placeholder: input.placeholder || "",
                  a11y: getA11yInfo(input)
                })),
                // Add more detailed DOM information
                headings: Array.from(doc.querySelectorAll('h1, h2, h3') || []).map(h => ({
                  level: h.tagName.toLowerCase(),
                  text: h.innerText || h.textContent || "",
                  a11y: getA11yInfo(h)
                })).slice(0, 20),
                buttons: Array.from(doc.querySelectorAll('button') || []).map(btn => ({
                  text: btn.innerText || btn.textContent || "",
                  id: btn.id || "",
                  disabled: btn.disabled || false,
                  a11y: getA11yInfo(btn)
                })).slice(0, 20)
              };
            } catch (err) {
              console.error("Error in page content extraction:", err);
              return {
                html: "",
                text: "Error extracting page content: " + err.message,
                a11yTree: [],
                links: [],
                inputs: [],
                headings: [],
                buttons: []
              };
            }
          })();
        `);

        console.log("Successfully captured page content");
        const pageData = { url, title, content };
        await window.aiBrowser.sendPageSnapshot(pageData);
      } catch (error) {
        console.error("Error capturing page snapshot:", error);
        // Send empty data if there was an error
        await window.aiBrowser.sendPageSnapshot({});
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

  /**
   * Execute a single action
   * @param {Object} action - The action to execute
   * @returns {Promise<void>}
   */
  async executePlan(action) {
    if (!action) {
      console.error("No action provided to executePlan");
      this.updateStatus("No action to execute");
      return;
    }

    console.log("Renderer PlanExecutor: executing action", action);
    const { action: actionType, selector, value, url, xpath } = action;

    this.updateStatus(`Executing ${actionType}`);

    try {
      await this.executeStep(action);
      console.log(
        `Renderer PlanExecutor: action ${actionType} completed successfully`
      );

      this.logger.logAction({
        action: actionType,
        selector,
        value,
        url,
        status: "success",
      });

      this.updateStatus(`Action ${actionType} completed`);
    } catch (e) {
      console.error("Renderer PlanExecutor: error executing action:", e);
      this.logger.logAction({
        action: actionType,
        selector,
        value,
        url,
        status: "error",
        error: e.message,
      });

      this.showFallback(e.message);
    }
  }

  /**
   * Execute a single step
   * @param {Object} step - The step to execute
   * @returns {Promise<void>}
   */
  async executeStep(step) {
    if (!step || !step.action) {
      throw new Error("Invalid step: missing action property");
    }

    const { action, selector, value, url, xpath } = step;
    console.log(`Renderer PlanExecutor: executing step ${action}`, {
      selector,
      value,
      url,
      xpath,
    });

    switch (action) {
      case "navigate":
        await new Promise((resolve, reject) => {
          const loadHandler = () => {
            this.webview.removeEventListener("did-finish-load", loadHandler);
            resolve();
          };

          const failHandler = (event) => {
            this.webview.removeEventListener("did-fail-load", failHandler);
            reject(
              new Error(
                `Failed to load ${url}: ${
                  event
                    ? event.errorDescription || "unknown error"
                    : "unknown error"
                }`
              )
            );
          };

          this.webview.addEventListener("did-finish-load", loadHandler);
          this.webview.addEventListener("did-fail-load", failHandler);

          console.log(`Renderer PlanExecutor: navigating to ${url}`);
          this.webview.loadURL(url);

          setTimeout(() => {
            console.log(
              `Renderer PlanExecutor: navigation timeout for ${url}, resolving anyway`
            );
            this.webview.removeEventListener("did-finish-load", loadHandler);
            this.webview.removeEventListener("did-fail-load", failHandler);
            resolve();
          }, 10000);
        });
        break;

      case "click":
        console.log(`Renderer PlanExecutor: attempting to click element`, {
          selector,
          xpath,
        });
        const clickResult = await this.webview.executeJavaScript(`
          (() => {
            try {
              let el;
              console.log("Browser: looking for element to click", { selector: ${JSON.stringify(
                selector
              )}, xpath: ${JSON.stringify(xpath)} });
              
              // Try CSS selector first
              ${
                selector
                  ? `
                try {
                  console.log("Browser: trying CSS selector: ${selector}");
                  el = document.querySelector(${JSON.stringify(selector)});
                  if (el) console.log("Browser: found element with CSS selector");
                } catch (e) {
                  console.error("Browser: error with CSS selector:", e);
                }
              `
                  : ""
              }
              
              // If XPath is provided and CSS selector didn't work, try XPath
              ${
                xpath
                  ? `
                if (!el) {
                  try {
                    console.log("Browser: trying XPath: ${xpath}");
                    const xpath = ${JSON.stringify(xpath)};
                    const xpathResult = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = xpathResult.singleNodeValue;
                    if (el) console.log("Browser: found element with XPath");
                  } catch (e) {
                    console.error("Browser: error with XPath:", e);
                  }
                }
              `
                  : ""
              }
              
              // Try finding by accessibility attributes if neither worked
              if (!el) {
                console.log("Browser: trying accessibility attributes");
                try {
                  // Find by aria-label, innerText, or other accessibility attributes
                  const potentialElements = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]'));
                  console.log("Browser: found " + potentialElements.length + " potential elements");
                  
                  const searchText = ${JSON.stringify(
                    (selector || "").toLowerCase()
                  )};
                  el = potentialElements.find(e => {
                    const ariaLabel = e.getAttribute('aria-label');
                    const innerText = e.innerText;
                    const textContent = e.textContent;
                    
                    const matched = 
                      (ariaLabel && ariaLabel.toLowerCase().includes(searchText)) ||
                      (innerText && innerText.toLowerCase().includes(searchText)) ||
                      (textContent && textContent.toLowerCase().includes(searchText));
                      
                    if (matched) {
                      console.log("Browser: found element via text match:", { 
                        element: e.tagName, 
                        ariaLabel: ariaLabel, 
                        innerText: innerText && innerText.substring(0, 50),
                        matched: true 
                      });
                    }
                    return matched;
                  });
                } catch (e) {
                  console.error("Browser: error finding by accessibility:", e);
                }
              }
              
              if (!el) {
                console.error("Browser: no element found for clicking");
                throw new Error('Element not found: ' + ${JSON.stringify(
                  selector || xpath || "No selector provided"
                )});
              }
              
              console.log("Browser: clicking element", { 
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                text: el.innerText ? el.innerText.substring(0, 50) : null
              });
              
              el.click();
              return { success: true, element: { tagName: el.tagName, id: el.id, className: el.className } };
            } catch (error) {
              console.error("Browser: error in click action:", error);
              return { success: false, error: error.message };
            }
          })();
        `);

        console.log("Renderer PlanExecutor: click result", clickResult);

        if (!clickResult.success) {
          throw new Error(`Failed to click element: ${clickResult.error}`);
        }
        break;

      case "type":
        console.log(`Renderer PlanExecutor: attempting to type text`, {
          selector,
          xpath,
          value,
        });
        const typeResult = await this.webview.executeJavaScript(`
          (() => {
            try {
              let el;
              console.log("Browser: looking for element to type in", { selector: ${JSON.stringify(
                selector
              )}, xpath: ${JSON.stringify(xpath)} });
              
              // Try CSS selector first
              ${
                selector
                  ? `
                try {
                  console.log("Browser: trying CSS selector: ${selector}");
                  el = document.querySelector(${JSON.stringify(selector)});
                  if (el) console.log("Browser: found input element with CSS selector");
                } catch (e) {
                  console.error("Browser: error with CSS selector:", e);
                }
              `
                  : ""
              }
              
              // If XPath is provided and CSS selector didn't work, try XPath
              ${
                xpath
                  ? `
                if (!el) {
                  try {
                    console.log("Browser: trying XPath: ${xpath}");
                    const xpath = ${JSON.stringify(xpath)};
                    const xpathResult = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = xpathResult.singleNodeValue;
                    if (el) console.log("Browser: found input element with XPath");
                  } catch (e) {
                    console.error("Browser: error with XPath:", e);
                  }
                }
              `
                  : ""
              }
              
              // Try finding by accessibility attributes if neither worked
              if (!el) {
                console.log("Browser: trying to find input by accessibility attributes");
                try {
                  // Find inputs by placeholder, name, label, etc.
                  const potentialInputs = Array.from(document.querySelectorAll('input, textarea, [role="textbox"], [contenteditable="true"]'));
                  console.log("Browser: found " + potentialInputs.length + " potential input elements");
                  
                  const searchText = ${JSON.stringify(
                    (selector || "").toLowerCase()
                  )};
                  el = potentialInputs.find(e => {
                    const placeholder = e.getAttribute('placeholder');
                    const name = e.getAttribute('name');
                    const ariaLabel = e.getAttribute('aria-label');
                    
                    const matched = 
                      (placeholder && placeholder.toLowerCase().includes(searchText)) ||
                      (name && name.toLowerCase().includes(searchText)) ||
                      (ariaLabel && ariaLabel.toLowerCase().includes(searchText));
                      
                    if (matched) {
                      console.log("Browser: found input element via attribute match:", { 
                        element: e.tagName, 
                        type: e.type,
                        placeholder: placeholder,
                        name: name,
                        ariaLabel: ariaLabel,
                        matched: true 
                      });
                    }
                    return matched;
                  });
                } catch (e) {
                  console.error("Browser: error finding input by accessibility:", e);
                }
              }
              
              if (!el) {
                console.error("Browser: no input element found for typing");
                throw new Error('Input element not found: ' + ${JSON.stringify(
                  selector || xpath || "No selector provided"
                )});
              }
              
              console.log("Browser: typing into element", { 
                tagName: el.tagName,
                id: el.id,
                type: el.type,
                name: el.name,
                value: ${JSON.stringify(value)}
              });
              
              el.focus();
              el.value = ${JSON.stringify(value)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              try {
                // Also trigger change event for good measure
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } catch(e) {
                console.warn("Browser: couldn't dispatch change event", e);
              }
              return { success: true, element: { tagName: el.tagName, id: el.id, type: el.type } };
            } catch (error) {
              console.error("Browser: error in type action:", error);
              return { success: false, error: error.message };
            }
          })();
        `);

        console.log("Renderer PlanExecutor: type result", typeResult);

        if (!typeResult.success) {
          throw new Error(`Failed to type into element: ${typeResult.error}`);
        }
        break;

      case "scroll":
        console.log(`Renderer PlanExecutor: attempting to scroll`, {
          selector,
          xpath,
          value,
        });
        const scrollResult = await this.webview.executeJavaScript(`
          (() => {
            try {
              let el;
              console.log("Browser: looking for element to scroll", { selector: ${JSON.stringify(
                selector
              )}, xpath: ${JSON.stringify(xpath)} });
              
              // Try CSS selector first
              ${
                selector
                  ? `
                try {
                  console.log("Browser: trying CSS selector: ${selector}");
                  el = document.querySelector(${JSON.stringify(selector)});
                  if (el) console.log("Browser: found scrollable element with CSS selector");
                } catch (e) {
                  console.error("Browser: error with CSS selector:", e);
                }
              `
                  : ""
              }
              
              // If XPath is provided and CSS selector didn't work, try XPath
              ${
                xpath
                  ? `
                if (!el) {
                  try {
                    console.log("Browser: trying XPath: ${xpath}");
                    const xpath = ${JSON.stringify(xpath)};
                    const xpathResult = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = xpathResult.singleNodeValue;
                    if (el) console.log("Browser: found scrollable element with XPath");
                  } catch (e) {
                    console.error("Browser: error with XPath:", e);
                  }
                }
              `
                  : ""
              }
              
              // If no element found, use document.scrollingElement
              if (!el) {
                console.log("Browser: using document.scrollingElement for scrolling");
                el = document.scrollingElement;
              }
              
              if (!el) {
                console.error("Browser: no scrollable element found");
                throw new Error('Scrollable element not found');
              }
              
              console.log("Browser: scrolling element", { 
                tagName: el.tagName,
                id: el.id,
                scrollAmount: ${value}
              });
              
              el.scrollBy(0, ${value});
              return { success: true };
            } catch (error) {
              console.error("Browser: error in scroll action:", error);
              return { success: false, error: error.message };
            }
          })();
        `);

        console.log("Renderer PlanExecutor: scroll result", scrollResult);

        if (!scrollResult.success) {
          throw new Error(`Failed to scroll: ${scrollResult.error}`);
        }
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
