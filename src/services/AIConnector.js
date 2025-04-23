const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

class AIConnector {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Capture a snapshot of the current page
   * @param {Object} webview - The Electron webview object
   * @returns {Promise<Object>} Page snapshot data
   */
  async capturePageSnapshot(webview) {
    try {
      const url = await webview.getURL();
      const title = await webview.getTitle();
      const content = await webview.executeJavaScript(`
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

      return {
        url,
        title,
        content,
      };
    } catch (error) {
      console.error("Error capturing page snapshot:", error);
      throw error;
    }
  }

  /**
   * Generate a single action based on a command and page snapshot
   * @param {string} command - The user command
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Promise<Object>} A single action step
   */
  async generatePlan(command, pageSnapshot = {}) {
    try {
      const systemPrompt = `You are an AI browser automation agent. Receive a natural language command and the current page content, then output a SINGLE action step in JSON format. The step should have 'action', 'selector', and optional 'value' or 'url'.

Allowed actions:
- navigate: requires url parameter
- click: requires selector parameter 
- type: requires selector and value parameters
- scroll: requires value parameter (number of pixels)

For selectors, use the most specific and reliable CSS selector. Prefer using IDs, then unique classes, then more complex selectors if needed. For accessibility, also consider using XPath selectors when appropriate.

IMPORTANT: Only return a SINGLE action step that can be executed immediately, not a full plan or sequence of steps. This should be the next logical action based on the command and current page state.

For better accessibility-based selection, use the a11yTree information provided to identify elements by their accessibility properties like role, label, and name. This information is more reliable for finding the right elements, especially when visual elements don't have clear IDs or classes.`;

      // If we don't have page info, create a simple navigation action
      if (!pageSnapshot.url && command.toLowerCase().includes("go to")) {
        const targetUrl = this.extractUrlFromCommand(command);
        console.log(`Creating a simple navigation step to ${targetUrl}`);
        return {
          action: "navigate",
          url: targetUrl,
        };
      }

      // Create a concise representation of the page with defensive programming
      const pageContent = pageSnapshot.content || {};

      // Build a structured overview of the page
      const pageContext = {
        url: pageSnapshot.url || "about:blank",
        title: pageSnapshot.title || "",
        a11yTree: pageContent.a11yTree || [],
        availableInputs: pageContent.inputs || [],
        availableLinks: pageContent.links || [],
        headings: pageContent.headings || [],
        buttons: pageContent.buttons || [],
      };

      // Save pageContext to a file for manual verification
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logsDir = path.join(__dirname, "../../logs");

      // Create logs directory if it doesn't exist
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const filename = path.join(logsDir, `pageContext-${timestamp}.json`);
      fs.writeFileSync(filename, JSON.stringify(pageContext, null, 2));
      console.log(`Saved pageContext to ${filename}`);

      // Add first 500 chars of page text for context
      const pageText = pageContent.text
        ? `Page text snippet: ${pageContent.text.substring(0, 500)}...`
        : "No page text available";

      console.log("Sending command to OpenAI:", command);
      console.log("Page context URL:", pageContext.url);

      const chat = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Command: ${command}\n\nCurrent page: ${JSON.stringify(
              pageContext
            )}\n\n${pageText}\n\nPlease analyze the accessibility tree (a11yTree) to find the most appropriate elements to interact with.`,
          },
        ],
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const responseContent = chat.choices[0].message.content;
      console.log("Response content:", responseContent);

      try {
        // Parse the JSON response
        const parsedResponse = JSON.parse(responseContent);

        // If we got a single action object, return it directly
        if (
          parsedResponse.action &&
          typeof parsedResponse.action === "string"
        ) {
          return parsedResponse;
        }

        // If we got a steps array, just return the first item
        if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
          return parsedResponse[0];
        }

        // Handle the case where action is nested inside a property
        if (
          parsedResponse.steps &&
          Array.isArray(parsedResponse.steps) &&
          parsedResponse.steps.length > 0
        ) {
          return parsedResponse.steps[0];
        }

        if (
          parsedResponse.actions &&
          Array.isArray(parsedResponse.actions) &&
          parsedResponse.actions.length > 0
        ) {
          return parsedResponse.actions[0];
        }

        if (
          parsedResponse.plan &&
          Array.isArray(parsedResponse.plan) &&
          parsedResponse.plan.length > 0
        ) {
          return parsedResponse.plan[0];
        }

        throw new Error("No valid action found in AI response");
      } catch (err) {
        throw new Error(
          "Failed to parse action JSON: " +
            err.message +
            ". Content: " +
            responseContent
        );
      }
    } catch (error) {
      console.error("Error generating action:", error);
      throw error;
    }
  }

  /**
   * Extract URL from a command like "go to youtube"
   * @param {string} command - The user command
   * @returns {string} The extracted URL
   */
  extractUrlFromCommand(command) {
    // Simple extraction for "go to" commands
    const words = command.toLowerCase().split(/\s+/);
    const goToIndex = words.findIndex((word) => word === "go");

    if (
      goToIndex !== -1 &&
      words[goToIndex + 1] === "to" &&
      words[goToIndex + 2]
    ) {
      const site = words[goToIndex + 2].trim();

      // Check if it's already a URL
      if (site.startsWith("http://") || site.startsWith("https://")) {
        return site;
      }

      // Check if it contains a TLD
      if (site.includes(".")) {
        return `https://${site}`;
      }

      // Otherwise assume it's a well-known site
      return `https://www.${site}.com`;
    }

    // Default to a search if we can't parse it
    return `https://www.google.com/search?q=${encodeURIComponent(command)}`;
  }
}

module.exports = AIConnector;
