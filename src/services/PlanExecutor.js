class PlanExecutor {
  constructor(webview, statusElement, logger) {
    this.webview = webview;
    this.statusElement = statusElement;
    this.logger = logger;
  }

  /**
   * Execute a single action step
   * @param {Object} action - The action to execute
   * @returns {Promise<void>}
   */
  async executePlan(action) {
    // For backward compatibility, if we receive an array, just take the first item
    if (Array.isArray(action) && action.length > 0) {
      action = action[0];
    }

    if (!action || !action.action) {
      this.updateStatus("No valid action to execute");
      return;
    }

    const { action: actionType, selector, value, url } = action;

    this.updateStatus(`Executing ${actionType}`);

    try {
      await this.executeStep(action);

      this.logger.logAction({
        action: actionType,
        selector,
        value,
        url,
        status: "success",
      });

      this.updateStatus(`Action ${actionType} completed`);
    } catch (e) {
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
   * Execute a single step of the plan
   * @param {Object} step - The step to execute
   * @returns {Promise<void>}
   */
  async executeStep(step) {
    const { action, selector, value, url } = step;

    switch (action) {
      case "navigate":
        await new Promise((resolve, reject) => {
          const loadHandler = () => {
            this.webview.removeEventListener("did-finish-load", loadHandler);
            resolve();
          };

          const failHandler = () => {
            this.webview.removeEventListener("did-fail-load", failHandler);
            reject(new Error("Failed to load " + url));
          };

          this.webview.addEventListener("did-finish-load", loadHandler);
          this.webview.addEventListener("did-fail-load", failHandler);

          this.webview.loadURL(url);

          setTimeout(() => {
            this.webview.removeEventListener("did-finish-load", loadHandler);
            this.webview.removeEventListener("did-fail-load", failHandler);
            resolve();
          }, 10000);
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

  /**
   * Update the status element with a message
   * @param {string} message - The status message
   */
  updateStatus(message) {
    if (this.statusElement) {
      this.statusElement.innerText = message;
    }
  }

  /**
   * Show a fallback dialog when automation fails
   * @param {string} message - The error message
   */
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

module.exports = PlanExecutor;
