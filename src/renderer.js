// Import client-side components
// Note: Since this is running in the renderer process without Node.js integration,
// we need to implement these components here directly rather than importing.

/**
 * Class to extract content from the current page in the webview
 */
class PageContentExtractor {
  /**
   * Creates a new PageContentExtractor
   * @param {Object} webview - The Electron webview object
   */
  constructor(webview) {
    this.webview = webview;
  }

  /**
   * Capture a snapshot of the current page
   * @returns {Promise<Object>} Page snapshot data
   */
  async capturePageSnapshot() {
    try {
      // Capture basic page information
      const url = await this.webview.getURL();
      const title = await this.webview.getTitle();

      // Extract detailed page content via JavaScript
      const content = await this.executeContentExtraction();

      console.log("Successfully captured page content");
      return {
        url,
        title,
        viewport: content.viewport,
        headings: content.headings,
        elements: content.elements,
        forms: content.forms,
        history: content.history || [], // Default to empty array if not provided
      };
    } catch (error) {
      console.error("Error capturing page snapshot:", error);
      return {
        url: "",
        title: "",
        viewport: { width: 0, height: 0 },
        headings: [],
        elements: [],
        forms: [],
        history: [],
      };
    }
  }

  /**
   * Execute JavaScript in the webview to extract page content
   * @returns {Promise<Object>} Extracted content
   */
  async executeContentExtraction() {
    return await this.webview.executeJavaScript(`
      (function() {
        try {
          const doc = document;
          
          // Generate a unique selector for an element
          function generateSelector(el) {
            if (!el || el === document || el === document.documentElement) return '';
            if (el.id) return '#' + el.id;
            
            // Try to create a selector with tag name and classes
            let selector = el.tagName.toLowerCase();
            if (el.className) {
              const classes = el.className.trim().split(/\\s+/);
              if (classes.length > 0 && classes[0]) {
                selector += '.' + classes.join('.');
              }
            }
            
            // Check if this is unique enough
            if (doc.querySelectorAll(selector).length === 1) return selector;
            
            // Add nth-child to make it more specific
            let parent = el.parentNode;
            if (parent) {
              const siblings = Array.from(parent.children);
              const index = siblings.indexOf(el) + 1;
              return generateSelector(parent) + ' > ' + selector + ':nth-child(' + index + ')';
            }
            
            return selector;
          }
          
          // Get viewport dimensions
          const viewport = {
            width: window.innerWidth || document.documentElement.clientWidth,
            height: window.innerHeight || document.documentElement.clientHeight
          };
          
          // Extract headings
          const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
            level: parseInt(h.tagName.charAt(1)),
            text: h.innerText || h.textContent || "",
            selector: generateSelector(h)
          }));
          
          // Extract interactive elements
          const elements = [];
          const interactiveSelectors = [
            'a', 'button', 'input', 'select', 'textarea', 'label'
          ].join(',');
          
          Array.from(doc.querySelectorAll(interactiveSelectors)).forEach(el => {
            const tagName = el.tagName.toLowerCase();
            
            // Skip hidden elements
            const isHidden = el.hidden || 
                           el.getAttribute('aria-hidden') === 'true' || 
                           el.style.display === 'none' || 
                           el.style.visibility === 'hidden';
            if (isHidden) return;
            
            const rect = el.getBoundingClientRect();
            
            elements.push({
              tag: tagName,
              role: el.getAttribute('role') || undefined,
              type: tagName === 'input' ? (el.type || undefined) : undefined,
              name: el.name || undefined,
              id: el.id || undefined,
              classes: el.className ? el.className.trim().split(/\\s+/) : [],
              text: (el.innerText || el.textContent || el.value || "").substring(0, 100),
              placeholder: el.placeholder || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
              href: tagName === 'a' ? el.href : undefined,
              boundingRect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              },
              selector: generateSelector(el)
            });
          });
          
          // Extract forms and their fields
          const forms = [];
          Array.from(doc.querySelectorAll('form')).forEach(form => {
            const fields = [];
            
            Array.from(form.querySelectorAll('input, select, textarea')).forEach(field => {
              fields.push({
                selector: generateSelector(field),
                name: field.name || undefined,
                type: field.type || undefined,
                placeholder: field.placeholder || undefined,
                ariaLabel: field.getAttribute('aria-label') || undefined
              });
            });
            
            forms.push({
              id: form.id || undefined,
              action: form.action || undefined,
              selector: generateSelector(form),
              fields: fields
            });
          });
          
          // We don't have access to action history from the page context,
          // so we'll return an empty array - the app will need to populate this
          const history = [];
          
          return {
            viewport,
            headings,
            elements,
            forms,
            history
          };
        } catch (err) {
          console.error("Error in page content extraction:", err);
          return {
            viewport: { width: 0, height: 0 },
            headings: [],
            elements: [],
            forms: [],
            history: []
          };
        }
      })();
    `);
  }
}

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
    this.pageContentExtractor = new PageContentExtractor(this.webview);

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

    // Microphone button click
    const micBtn = document.getElementById("mic-btn");
    if (micBtn) {
      micBtn.addEventListener("click", () => {
        this.startVoicePrompt();
      });
    }

    // Explain Page button click
    const explainBtn = document.getElementById("explain-btn");
    if (explainBtn) {
      explainBtn.addEventListener("click", async () => {
        this.statusSpan.innerText = "Generating page explanation...";
        explainBtn.disabled = true;

        try {
          const explanation = await window.aiBrowser.explainPage();
          console.log("Received page explanation:", explanation);

          if (explanation.status === "ok" && explanation.explanation) {
            this.showExplanationPopup(explanation.explanation);
            this.statusSpan.innerText = "Page explanation generated.";
          } else {
            throw new Error(
              explanation.error || "Failed to generate explanation"
            );
          }
        } catch (err) {
          console.error("Error generating page explanation:", err);
          this.statusSpan.innerText = "Error: " + err.message;
        } finally {
          explainBtn.disabled = false;
        }
      });
    }

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

    // Add keyboard shortcuts at document level
    document.addEventListener("keydown", (e) => {
      // Voice prompt on Command+L always
      if (e.metaKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        this.startVoicePrompt();
        return;
      }

      // Only handle other shortcuts when webview is not focused
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
    });

    // Add window-level event listener for Command+L to ensure it works globally
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.metaKey && e.key.toLowerCase() === "l") {
          e.preventDefault();
          e.stopPropagation();
          this.startVoicePrompt();
        }
      },
      true
    );

    // Ensure Command+L works in webview by handling webview keydown events
    this.webview.addEventListener("keydown", (e) => {
      // For Command+L, we need to prevent webview default behavior
      if (e.metaKey && e.key.toLowerCase() === "l") {
        this.webview.stop(); // Stop any navigation
        e.preventDefault();
        this.startVoicePrompt();
      }
    });

    // Add listener for webview load to inject key listener directly into the page
    this.webview.addEventListener("dom-ready", () => {
      // Inject a script that will forward Command+L to the parent window
      this.webview.executeJavaScript(`
        // Remove any existing listener first to avoid duplicates
        if (window._commandLHandler) {
          document.removeEventListener('keydown', window._commandLHandler);
        }
        
        // Create a listener that will send a message to the parent window
        window._commandLHandler = function(e) {
          if (e.metaKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            e.stopPropagation();
            window.parent.postMessage({ type: 'command-l-pressed' }, '*');
            return false;
          }
        };
        
        // Add the listener to the document
        document.addEventListener('keydown', window._commandLHandler, true);
        
        // Also add to any iframes that might be present
        try {
          const frames = document.querySelectorAll('iframe');
          frames.forEach(frame => {
            if (frame.contentDocument) {
              frame.contentDocument.addEventListener('keydown', window._commandLHandler, true);
            }
          });
        } catch(err) {
          console.error('Error adding key handlers to iframes:', err);
        }

        console.log('Command+L handler injected into page');
      `);
    });

    // Listen for messages from the webview
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "command-l-pressed") {
        this.startVoicePrompt();
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
        // Use the PageContentExtractor to capture the page snapshot
        const pageData = await this.pageContentExtractor.capturePageSnapshot();

        // Save page data to a file
        this.savePageDataToFile(pageData);

        await window.aiBrowser.sendPageSnapshot(pageData);
      } catch (error) {
        console.error("Error in page snapshot handler:", error);
        // Send empty data if there was an error
        await window.aiBrowser.sendPageSnapshot({});
      }
    });
  }

  /**
   * Save page data to a file in the current directory
   * @param {Object} pageData - The page snapshot data
   */
  savePageDataToFile(pageData) {
    try {
      // Create a filename based on the current timestamp and page title
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const sanitizedTitle = (pageData.title || "untitled")
        .replace(/[^a-z0-9]/gi, "_")
        .substring(0, 30);
      const filename = `page_snapshot_${sanitizedTitle}_${timestamp}.json`;

      // Convert the data to JSON
      const jsonData = JSON.stringify(pageData, null, 2);

      // Use IPC to save the file via the main process
      window.aiBrowser
        .saveFile(filename, jsonData)
        .then(() => console.log(`Page snapshot saved to ${filename}`))
        .catch((err) => console.error("Error saving page snapshot:", err));
    } catch (error) {
      console.error("Error preparing page data for saving:", error);
    }
  }

  /**
   * Start voice-based prompt: record audio, transcribe, read aloud, then confirm
   */
  async startVoicePrompt() {
    try {
      this.statusSpan.innerText = "Listening...";

      // Toggle recording state on mic button
      const micBtn = document.getElementById("mic-btn");
      if (micBtn) {
        micBtn.classList.add("recording");
      }

      // Pause all media in the webview
      const pausedMediaElements = await this.pauseAllMedia();

      // Create recording overlay
      const overlay = document.createElement("div");
      overlay.id = "voice-overlay";
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
        zIndex: "3000",
      });
      const stopBtn = document.createElement("button");
      stopBtn.textContent = "Stop Recording";
      Object.assign(stopBtn.style, { padding: "12px 24px", fontSize: "16px" });
      overlay.appendChild(stopBtn);
      document.body.appendChild(overlay);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: "audio/webm;codecs=opus" };
      const recorder = new MediaRecorder(stream, options);
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        document.body.removeChild(overlay);
        stream.getTracks().forEach((t) => t.stop());

        // Reset mic button state
        if (micBtn) {
          micBtn.classList.remove("recording");
        }

        this.statusSpan.innerText = "Processing audio...";
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64data = reader.result.split(",")[1];
          const resp = await window.aiBrowser.transcribeAudio(base64data);
          if (resp.status !== "ok") {
            console.error("Transcription error", resp.error);
            this.statusSpan.innerText = "Transcription failed";

            // Resume media playback on failure
            this.resumeMedia(pausedMediaElements);
            return;
          }
          const transcript = resp.transcript;
          // Read aloud
          const utter = new SpeechSynthesisUtterance(transcript);

          // Keep media paused during speech synthesis
          utter.onend = () => {
            // Only resume media after user makes a choice or dismisses
          };

          speechSynthesis.speak(utter);
          // Confirmation overlay
          const confirmOverlay = document.createElement("div");
          confirmOverlay.id = "confirm-overlay";
          Object.assign(confirmOverlay.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: "3000",
          });
          const msg = document.createElement("p");
          msg.textContent = `You said: "${transcript}". Press Y to execute or N to reset.`;
          Object.assign(msg.style, {
            color: "white",
            fontSize: "18px",
            background: "#000000cc",
            padding: "16px",
            borderRadius: "8px",
          });
          confirmOverlay.appendChild(msg);
          document.body.appendChild(confirmOverlay);
          const onKey = (e) => {
            if (e.key.toLowerCase() === "y") {
              this.commandInput.value = transcript;
              document.body.removeChild(confirmOverlay);
              document.removeEventListener("keydown", onKey);
              this.executeBtn.click();
              this.statusSpan.innerText = "";

              // Keep media paused as command executes
            } else if (e.key.toLowerCase() === "n") {
              this.commandInput.value = "";
              document.body.removeChild(confirmOverlay);
              document.removeEventListener("keydown", onKey);
              this.statusSpan.innerText = "";

              // Resume media playback on cancel
              this.resumeMedia(pausedMediaElements);
            }
          };
          document.addEventListener("keydown", onKey);
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      stopBtn.onclick = () => recorder.stop();
    } catch (err) {
      // Reset mic button state on error
      const micBtn = document.getElementById("mic-btn");
      if (micBtn) {
        micBtn.classList.remove("recording");
      }

      console.error("Error during voice prompt:", err);
      this.statusSpan.innerText = "Voice prompt error: " + err.message;
    }
  }

  /**
   * Pause all media elements in the webview and return information to resume them later
   * @returns {Promise<Array>} Array of media elements that were playing
   */
  async pauseAllMedia() {
    try {
      return await this.webview.executeJavaScript(`
        (function() {
          // Find all media elements (video and audio)
          const mediaElements = Array.from(document.querySelectorAll('video, audio'));
          
          // Track which elements were playing
          const playingElements = [];
          
          // Pause each media element and record its state
          mediaElements.forEach((media, index) => {
            if (!media.paused) {
              // Record information about the playing media
              playingElements.push({
                index,
                currentTime: media.currentTime,
                wasPlaying: true
              });
              
              // Pause the media
              media.pause();
              console.log('Paused media element:', media);
            }
          });
          
          console.log('Paused media elements:', playingElements.length);
          return playingElements;
        })();
      `);
    } catch (err) {
      console.error("Error pausing media:", err);
      return [];
    }
  }

  /**
   * Resume previously paused media elements
   * @param {Array} pausedMediaElements - Array of media elements that were playing
   */
  async resumeMedia(pausedMediaElements) {
    if (!pausedMediaElements || pausedMediaElements.length === 0) {
      return;
    }

    try {
      await this.webview.executeJavaScript(`
        (function() {
          // Get all media elements again
          const mediaElements = Array.from(document.querySelectorAll('video, audio'));
          
          // Resume elements that were playing
          const toResume = ${JSON.stringify(pausedMediaElements)};
          
          toResume.forEach(item => {
            const media = mediaElements[item.index];
            if (media && item.wasPlaying) {
              // Resume playback
              media.currentTime = item.currentTime;
              media.play()
                .then(() => console.log('Resumed media playback'))
                .catch(err => console.error('Error resuming playback:', err));
            }
          });
          
          console.log('Attempted to resume', toResume.length, 'media elements');
        })();
      `);
    } catch (err) {
      console.error("Error resuming media:", err);
    }
  }

  /**
   * Show a popup with the page explanation
   * @param {Object} explanation - The page explanation data
   */
  showExplanationPopup(explanation) {
    // Remove any existing explanation overlay
    const existingOverlay = document.querySelector(".explanation-overlay");
    if (existingOverlay) {
      document.body.removeChild(existingOverlay);
    }

    // Create overlay and dialog elements
    const overlay = document.createElement("div");
    overlay.className = "explanation-overlay";

    const dialog = document.createElement("div");
    dialog.className = "explanation-dialog";

    // Create header with title and close button
    const header = document.createElement("div");
    header.className = "explanation-header";

    const title = document.createElement("h2");
    title.textContent = "Page Explanation";

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Create content container
    const content = document.createElement("div");
    content.className = "explanation-content";

    // Add summary section
    const summarySection = document.createElement("div");
    summarySection.className = "explanation-section";

    const summaryTitle = document.createElement("h3");
    summaryTitle.textContent = "Summary";

    const summaryText = document.createElement("p");
    summaryText.textContent = explanation.summary;

    summarySection.appendChild(summaryTitle);
    summarySection.appendChild(summaryText);
    content.appendChild(summarySection);

    // Add content details section if available
    if (explanation.contentDetails) {
      const contentSection = document.createElement("div");
      contentSection.className = "explanation-section";

      const contentTitle = document.createElement("h3");
      contentTitle.textContent = "Content on this Page";
      contentSection.appendChild(contentTitle);

      const contentText = document.createElement("p");
      contentText.textContent = explanation.contentDetails;
      contentSection.appendChild(contentText);

      content.appendChild(contentSection);
    }

    // Add suggested actions if available
    if (
      explanation.suggestedActions &&
      explanation.suggestedActions.length > 0
    ) {
      const actionsSection = document.createElement("div");
      actionsSection.className = "explanation-actions";

      const actionsTitle = document.createElement("h3");
      actionsTitle.textContent = "Suggested Actions";
      actionsSection.appendChild(actionsTitle);

      explanation.suggestedActions.forEach((action) => {
        const actionBtn = document.createElement("button");
        actionBtn.className = "suggested-action";
        actionBtn.textContent = action;
        actionBtn.addEventListener("click", () => {
          this.commandInput.value = action;
          document.body.removeChild(overlay);
        });
        actionsSection.appendChild(actionBtn);
      });

      content.appendChild(actionsSection);
    }

    // Assemble dialog and overlay
    dialog.appendChild(header);
    dialog.appendChild(content);
    overlay.appendChild(dialog);

    // Add to document and show
    document.body.appendChild(overlay);
  }

  /**
   * Log an action through the IPC
   * @param {Object} record - The action record to log
   */
  logAction(record) {
    // Forward to main via preload
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

      // Log action via IPC directly
      window.aiBrowser.logAction({
        action: actionType,
        selector,
        value,
        url,
        status: "success",
      });

      this.updateStatus(`Action ${actionType} completed`);
    } catch (e) {
      console.error("Renderer PlanExecutor: error executing action:", e);
      // Log error via IPC directly
      window.aiBrowser.logAction({
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
