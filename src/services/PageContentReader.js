const fs = require("fs");
const path = require("path");

/**
 * Class responsible for reading and processing page content from webviews
 */
class PageContentReader {
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
   * Save page context to a file for debugging/verification
   * @param {Object} pageContext - The page context to save
   * @param {string} [customDir] - Optional custom directory to save in
   * @returns {string} The path to the saved file
   */
  savePageContextToFile(pageContext, customDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logsDir = customDir || path.join(__dirname, "../../logs");

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const filename = path.join(logsDir, `pageContext-${timestamp}.json`);
    fs.writeFileSync(filename, JSON.stringify(pageContext, null, 2));
    console.log(`Saved pageContext to ${filename}`);

    return filename;
  }
}

module.exports = PageContentReader;
