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
        a11yTree: pageContent.a11yTree || [],
        availableInputs: pageContent.inputs || [],
        availableLinks: pageContent.links || [],
        headings: pageContent.headings || [],
        buttons: pageContent.buttons || [],
      };

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
