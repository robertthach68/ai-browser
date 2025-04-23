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
    console.log("PlanExecutor: received action to execute", action);

    // For backward compatibility, if we receive an array, just take the first item
    if (Array.isArray(action) && action.length > 0) {
      console.log(
        "PlanExecutor: received array instead of single action, taking first item"
      );
      action = action[0];
    }

    if (!action) {
      const error = new Error("No action received");
      console.error("PlanExecutor:", error);
      this.updateStatus("No action to execute");
      throw error;
    }

    if (!action.action) {
      const error = new Error(
        `Invalid action format: missing 'action' property: ${JSON.stringify(
          action
        )}`
      );
      console.error("PlanExecutor:", error);
      this.updateStatus("Invalid action format");
      throw error;
    }

    const { action: actionType, selector, value, url, xpath } = action;
    console.log(`PlanExecutor: executing ${actionType} action`, {
      selector,
      value,
      url,
      xpath,
    });

    this.updateStatus(`Executing ${actionType}`);

    try {
      await this.executeStep(action);
      console.log(`PlanExecutor: successfully executed ${actionType} action`);

      this.logger.logAction({
        action: actionType,
        selector,
        value,
        url,
        status: "success",
      });

      this.updateStatus(`Action ${actionType} completed`);
    } catch (e) {
      console.error(`PlanExecutor: failed to execute ${actionType} action:`, e);

      this.logger.logAction({
        action: actionType,
        selector,
        value,
        url,
        status: "error",
        error: e.message,
      });

      this.showFallback(e.message);
      throw e; // Re-throw to allow caller to handle it
    }
  }

  /**
   * Execute a single step of the plan
   * @param {Object} step - The step to execute
   * @returns {Promise<void>}
   */
  async executeStep(step) {
    const { action, selector, value, url, xpath } = step;
    console.log(`PlanExecutor: executeStep for ${action} action`, {
      selector,
      value,
      url,
      xpath,
    });

    switch (action) {
      case "navigate":
        console.log(`PlanExecutor: navigating to ${url}`);
        await new Promise((resolve, reject) => {
          const loadHandler = () => {
            console.log(`PlanExecutor: page loaded successfully: ${url}`);
            this.webview.removeEventListener("did-finish-load", loadHandler);
            resolve();
          };

          const failHandler = (event) => {
            console.error(`PlanExecutor: page load failed: ${url}`, event);
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

          console.log(`PlanExecutor: calling webview.loadURL(${url})`);
          this.webview.loadURL(url);

          setTimeout(() => {
            console.log(
              `PlanExecutor: navigation timeout for ${url}, resolving anyway`
            );
            this.webview.removeEventListener("did-finish-load", loadHandler);
            this.webview.removeEventListener("did-fail-load", failHandler);
            resolve(); // Resolve anyway to avoid hanging
          }, 10000);
        });
        break;

      case "click":
        console.log(`PlanExecutor: attempting to click element`, {
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

        console.log("PlanExecutor: click result", clickResult);

        if (!clickResult.success) {
          throw new Error(`Failed to click element: ${clickResult.error}`);
        }
        break;

      case "type":
        console.log(`PlanExecutor: attempting to type text`, {
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

        console.log("PlanExecutor: type result", typeResult);

        if (!typeResult.success) {
          throw new Error(`Failed to type into element: ${typeResult.error}`);
        }
        break;

      case "scroll":
        console.log(`PlanExecutor: attempting to scroll`, {
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

        console.log("PlanExecutor: scroll result", scrollResult);

        if (!scrollResult.success) {
          throw new Error(`Failed to scroll: ${scrollResult.error}`);
        }
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
