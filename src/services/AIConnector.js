const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

class AIConnector {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
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
- scroll: requires value parameter (positive for down, negative for up)

COMMAND INTERPRETATION RULES:
1. When the command starts with "click" followed by text (e.g., "click sign in" or "click cry your heart out"), this ALWAYS means the user wants to click on an element containing that text, NOT search for it.
2. On YouTube specifically, "click [video title]" means finding and clicking on a video thumbnail or title that matches the text.
3. NEVER convert a "click [text]" command into a search operation unless explicitly instructed to search.
4. When the command starts with "search for" or explicitly mentions searching, generate a "type" action for search inputs.
5. Navigation commands (e.g., "go to youtube") should generate a "navigate" action.
6. Only use "type" action when the user explicitly wants to input text into a field, not when they want to find and click on content.

ELEMENT SELECTION PRIORITY:
1. First try to find elements with exact text matches in their innerText, textContent, title, aria-label, or alt attributes
2. Next, try to find elements containing partial text matches
3. For videos on YouTube, look for title elements, video thumbnails, or link elements

For selectors, use the most specific and reliable CSS selector. Prefer using IDs, then unique classes, then more complex selectors if needed. For accessibility, also consider using XPath selectors when appropriate.

IMPORTANT: Only return a SINGLE action step that can be executed immediately, not a full plan or sequence of steps. This should be the next logical action based on the command and current page state.
`;

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
      };

      // Include more detailed page structure information for better context
      if (pageSnapshot.elements) {
        // Check if we're on YouTube to add special handling
        const isYouTube = pageContext.url.includes("youtube.com");

        // Structure elements by type for easier reference
        pageContext.clickableElements = pageSnapshot.elements
          .filter((el) =>
            ["a", "button", "input", "div", "span", "img"].includes(el.tag)
          )
          .map((el) => {
            // Basic element properties
            const elementInfo = {
              tag: el.tag,
              text: el.text || "",
              id: el.id,
              classes: el.classes,
              selector: el.selector,
              ariaLabel: el.ariaLabel,
              type: el.type,
            };

            // Add special handling for YouTube videos
            if (isYouTube) {
              // Check if this element is likely a video title/thumbnail
              const isVideoElement =
                (el.classes &&
                  (el.classes.some(
                    (c) =>
                      c.includes("video") ||
                      c.includes("title") ||
                      c.includes("thumbnail")
                  ) ||
                    (el.text && el.tag === "a"))) ||
                (el.ariaLabel &&
                  (el.ariaLabel.includes("video") ||
                    el.ariaLabel.includes("watch")));

              if (isVideoElement) {
                elementInfo.isVideoElement = true;
              }
            }

            return elementInfo;
          })
          .slice(0, 30); // Increase limit to capture more elements

        // Add specific section for headings and form elements
        pageContext.headings = pageSnapshot.headings || [];
        pageContext.formElements = pageSnapshot.elements
          .filter(
            (el) =>
              el.tag === "input" || el.tag === "textarea" || el.tag === "select"
          )
          .map((el) => ({
            tag: el.tag,
            type: el.type || "",
            id: el.id,
            name: el.name,
            placeholder: el.placeholder,
            selector: el.selector,
          }))
          .slice(0, 10);
      } else {
        // Fallback to old format if necessary
        pageContext.a11yTree = pageContent.a11yTree || [];
        pageContext.availableInputs = pageContent.inputs || [];
        pageContext.availableLinks = pageContent.links || [];
        pageContext.headings = pageContent.headings || [];
        pageContext.buttons = pageContent.buttons || [];
      }

      // Add first 500 chars of page text for context
      const pageText = pageContent.text
        ? `Page text snippet: ${pageContent.text.substring(0, 500)}...`
        : "No page text available";

      console.log("Sending command to OpenAI:", command);
      console.log("Page context URL:", pageContext.url);

      const chat = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "developer", content: systemPrompt },
          {
            role: "user",
            content: `Command: ${command}

Current page: ${JSON.stringify(pageContext, null, 2)}

${pageText}

Processing Instructions:
1. For ALL "click" commands:
   - This is ALWAYS a request to find and click on an element containing the specified text
   - NEVER convert a "click [text]" into a search action unless explicitly told to search
   - Look for elements where the text matches in: text content, aria-label, title, or alt attributes

2. For YouTube specific handling:
   - If on YouTube and command is "click [video title]", look for elements marked as isVideoElement=true
   - For video titles, prefer elements that are links (<a> tags) with matching text
   - Consider video thumbnails and video titles as valid targets

3. Element selection priority:
   - First: Exact text matches
   - Second: Partial text matches beginning with the search text
   - Third: Any element containing part of the search text
   - Only use search input as a last resort if NO matching elements can be found

Command analysis:
${
  command.toLowerCase().startsWith("click")
    ? `- This is a CLICK command. The user wants to click on an element matching: "${command
        .replace("click", "")
        .trim()}"
  - DO NOT convert this to a search action - find and click the matching element`
    : `- Command type: ${
        command.toLowerCase().includes("search") ? "SEARCH" : "OTHER"
      }`
}

Please return a single action in JSON format that best accomplishes this command on the current page.`,
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
