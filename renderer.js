// renderer.js
const commandInput = document.getElementById("command-input");
const executeBtn = document.getElementById("execute-btn");
const statusSpan = document.getElementById("status");
const webview = document.getElementById("webview");

// Add browser navigation controls
const navControls = document.createElement("div");
navControls.id = "nav-controls";
Object.assign(navControls.style, {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "0 10px",
});

const backBtn = document.createElement("button");
backBtn.innerHTML = "&#8592;"; // Left arrow
backBtn.title = "Go Back";
backBtn.onclick = () => webview.goBack();

const forwardBtn = document.createElement("button");
forwardBtn.innerHTML = "&#8594;"; // Right arrow
forwardBtn.title = "Go Forward";
forwardBtn.onclick = () => webview.goForward();

const refreshBtn = document.createElement("button");
refreshBtn.innerHTML = "&#8635;"; // Reload symbol
refreshBtn.title = "Refresh";
refreshBtn.onclick = () => webview.reload();

const urlDisplay = document.createElement("span");
urlDisplay.id = "url-display";
Object.assign(urlDisplay.style, {
  marginLeft: "10px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: "1",
});

navControls.appendChild(backBtn);
navControls.appendChild(forwardBtn);
navControls.appendChild(refreshBtn);
navControls.appendChild(urlDisplay);

// Insert navigation controls before the command input in the prompt-bar
document.getElementById("prompt-bar").insertBefore(navControls, commandInput);

// Update URL display when loading a new page
webview.addEventListener("did-start-loading", () => {
  urlDisplay.textContent = "Loading...";
});

webview.addEventListener("did-finish-load", () => {
  webview.getURL().then((url) => {
    urlDisplay.textContent = url;
  });
});

webview.addEventListener("page-title-updated", (e) => {
  document.title = e.title + " - AI Browser";
});

// Update navigation button states
webview.addEventListener("did-navigate", () => {
  backBtn.disabled = !webview.canGoBack();
  forwardBtn.disabled = !webview.canGoForward();
  webview.getURL().then((url) => {
    urlDisplay.textContent = url;
  });
});

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
  { text: "Open DevTools", action: () => webview.openDevTools() },
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
      webview.executeJavaScript("window.location.href").then((url) => {
        const sourceUrl = "view-source:" + url;
        window.open(sourceUrl, "_blank");
      }),
  },
  { text: "Print Page", action: () => webview.print() },
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
  if (menuDropdown.style.display === "none" || !menuDropdown.style.display) {
    menuDropdown.style.display = "block";
  } else {
    menuDropdown.style.display = "none";
  }
});

// Close dropdown when clicking outside
document.addEventListener("click", () => {
  menuDropdown.style.display = "none";
});

// Add menu button to the prompt bar
document.getElementById("prompt-bar").appendChild(devToolsBtn);
document.body.appendChild(menuDropdown);

// Handle main process request to toggle DevTools
window.aiBrowser.onWebviewDevTools(() => {
  webview.isDevToolsOpened() ? webview.closeDevTools() : webview.openDevTools();
});

// Add keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Only handle when webview is not focused
  if (document.activeElement === webview) return;

  // Ctrl+R or F5 to refresh
  if ((e.ctrlKey && e.key === "r") || e.key === "F5") {
    webview.reload();
  }

  // Alt+Left to go back
  if (e.altKey && e.key === "ArrowLeft") {
    if (webview.canGoBack()) webview.goBack();
  }

  // Alt+Right to go forward
  if (e.altKey && e.key === "ArrowRight") {
    if (webview.canGoForward()) webview.goForward();
  }

  // Ctrl+L to focus URL input
  if (e.ctrlKey && e.key === "l") {
    webview.getURL().then((url) => {
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
          webview.loadURL(tempInput.value);
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
});

executeBtn.addEventListener("click", async () => {
  const command = commandInput.value.trim();
  if (!command) return;
  commandInput.disabled = true;
  executeBtn.disabled = true;
  statusSpan.innerText = "Planning...";
  try {
    const resp = await window.aiBrowser.executeCommand(command);
    if (resp.status !== "ok") {
      throw new Error(resp.error || "Unknown error");
    }
    const plan = resp.plan;
    statusSpan.innerText = "Plan ready";
    const runAI = confirm("Run AI actions? Cancel to manual.");
    if (runAI) {
      await execPlan(plan);
      statusSpan.innerText = "Done";
    } else {
      statusSpan.innerText = "Manual mode";
    }
  } catch (err) {
    console.error(err);
    statusSpan.innerText = "Error: " + err.message;
  } finally {
    commandInput.disabled = false;
    executeBtn.disabled = false;
  }
});

async function execPlan(plan) {
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const { action, selector, value, url } = step;
    statusSpan.innerText = `Executing ${action} (${i + 1}/${plan.length})`;
    try {
      switch (action) {
        case "navigate":
          await new Promise((resolve, reject) => {
            webview.loadURL(url);
            webview.once("did-finish-load", resolve);
            webview.once("did-fail-load", () =>
              reject(new Error("Failed to load " + url))
            );
          });
          break;
        case "click":
          await webview.executeJavaScript(`
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
          await webview.executeJavaScript(`
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
          await webview.executeJavaScript(`
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
      window.aiBrowser.logAction({
        action,
        selector,
        value,
        url,
        status: "success",
      });
    } catch (e) {
      window.aiBrowser.logAction({
        action,
        selector,
        value,
        url,
        status: "error",
        error: e.message,
      });
      showFallback(e.message);
      break;
    }
  }
}

function showFallback(message) {
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
    statusSpan.innerText = "Fallback to manual";
  });
  dialog.appendChild(msg);
  dialog.appendChild(btn);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}
