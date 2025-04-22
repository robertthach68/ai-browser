// renderer.js
const commandInput = document.getElementById("command-input");
const executeBtn = document.getElementById("execute-btn");
const statusSpan = document.getElementById("status");
const webview = document.getElementById("webview");

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
