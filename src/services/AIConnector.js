const OpenAI = require("openai");

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
        (() => {
          return {
            html: document.documentElement.outerHTML,
            text: document.body.innerText.substring(0, 5000), // Limit text capture
            links: Array.from(document.links).map(link => ({
              text: link.innerText,
              href: link.href
            })).slice(0, 50), // Limit number of links
            inputs: Array.from(document.querySelectorAll('input, textarea')).map(input => ({
              type: input.type,
              id: input.id,
              name: input.name,
              placeholder: input.placeholder
            }))
          };
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
   * Generate a plan based on a command and page snapshot
   * @param {string} command - The user command
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Promise<Array>} The action plan in JSON format
   */
  async generatePlan(command, pageSnapshot = {}) {
    try {
      const systemPrompt = `You are an AI browser automation agent. Receive a natural language command and the current page content, then output a JSON array of steps. Each step has 'action', 'selector', and optional 'value' or 'url'. Allowed actions: click, type, scroll, navigate.`;

      // Create a concise representation of the page with defensive programming
      const pageContent = pageSnapshot.content || {};
      const pageContext = {
        url: pageSnapshot.url || "about:blank",
        title: pageSnapshot.title || "",
        availableInputs: pageContent.inputs || [],
        availableLinks: pageContent.links || [],
        pageText: pageContent.text ? pageContent.text.substring(0, 1000) : "", // Limit text for token efficiency
      };

      // If we don't have page info, create a simple navigation plan
      if (!pageSnapshot.url && command.toLowerCase().includes("go to")) {
        const targetUrl = this.extractUrlFromCommand(command);
        return [
          {
            action: "navigate",
            url: targetUrl,
          },
        ];
      }

      const chat = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Command: ${command}\nCurrent page: ${JSON.stringify(
              pageContext
            )}`,
          },
        ],
        max_tokens: 500,
      });

      const responseContent = chat.choices[0].message.content;
      console.log("Response content:", responseContent);
      try {
        // Extract JSON if it's wrapped in markdown code blocks
        const jsonContent = responseContent
          .replace(/```json\n|\n```/g, "")
          .trim();
        return JSON.parse(jsonContent);
      } catch (err) {
        throw new Error(
          "Failed to parse plan JSON: " +
            err.message +
            ". Content: " +
            responseContent
        );
      }
    } catch (error) {
      console.error("Error generating plan:", error);
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
