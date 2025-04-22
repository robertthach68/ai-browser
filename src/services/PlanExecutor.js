class PlanExecutor {
  constructor(webview, statusElement, logger) {
    this.webview = webview;
    this.statusElement = statusElement;
    this.logger = logger;
  }

  /**
   * Execute a plan step by step
   * @param {Array} plan - The plan to execute
   * @returns {Promise<void>}
   */
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
