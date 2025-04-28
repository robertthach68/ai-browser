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
      // Handle special commands for suggestions, summaries, or descriptions
      if (
        command.toLowerCase().includes("suggest") ||
        command.toLowerCase().includes("what can i do")
      ) {
        return await this.generateSuggestedActions(pageSnapshot);
      }

      if (
        command.toLowerCase().includes("summarize") ||
        command.toLowerCase().includes("summary")
      ) {
        return await this.generatePageSummary(pageSnapshot);
      }

      if (
        command.toLowerCase().includes("describe content") ||
        command.toLowerCase().includes("what's on this page")
      ) {
        return await this.generateContentDescription(pageSnapshot);
      }

      const systemPrompt = `You are an AI browser automation agent. Receive a natural language command and the current page content, then output a SINGLE action step in JSON format. The step should have 'action', 'selector', and optional 'value' or 'url'.

Allowed actions:
- navigate: requires url parameter
- click: requires selector parameter 
- type: requires selector and value parameters
- scroll: requires value parameter (positive for down, negative for up)
- suggest_action: provides suggestions based on the page content
- summary_page: provides a summary of the current page
- describe_content: provides detailed description of the page content

COMMAND INTERPRETATION RULES:
1. When the command starts with "click" followed by text (e.g., "click sign in" or "click cry your heart out"), this ALWAYS means the user wants to click on an element containing that text, NOT search for it.
2. On YouTube specifically, "click [video title]" means finding and clicking on a video thumbnail or title that matches the text.
3. NEVER convert a "click [text]" command into a search operation unless explicitly instructed to search.
4. When the command starts with "search for" or explicitly mentions searching, generate a "type" action for search inputs.
5. Navigation commands (e.g., "go to youtube") should generate a "navigate" action.
6. Only use "type" action when the user explicitly wants to input text into a field, not when they want to find and click on content.
7. When the user asks for suggestions or "what can I do", use the "suggest_action" action.
8. When the user asks for a summary or to summarize the page, use the "summary_page" action.
9. When the user asks to describe the content or what's on the page, use the "describe_content" action.

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

        // Check if the response action is for content description or summary
        if (parsedResponse.action === "describe_content") {
          return await this.generateContentDescription(pageSnapshot);
        }

        if (parsedResponse.action === "summary_page") {
          return await this.generatePageSummary(pageSnapshot);
        }

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
   * Generate suggested actions based on the current page
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Promise<Object>} Action with suggestions
   */
  async generateSuggestedActions(pageSnapshot = {}) {
    console.log("Generating suggested actions for page");

    try {
      const pageContext = this.preparePageContext(pageSnapshot);

      const systemPrompt = `You are an AI browser assistant that helps users understand what actions they can take on a webpage.
      Your task is to analyze the current page and suggest 3-5 specific, actionable things the user could do.
      Focus on the main interactive elements and common user tasks for this type of page.
      Be specific to the current page content and what's visible, not generic web browsing advice.
      
      IMPORTANT: Return your response as a JSON object with a "suggestions" array containing strings of suggested actions.`;

      const chat = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Here is information about the current webpage:
            
URL: ${pageContext.url}
Title: ${pageContext.title}

# Page Structure
${JSON.stringify(pageContext.headings, null, 2)}

# Interactive Elements
${JSON.stringify(pageContext.clickableElements?.slice(0, 15), null, 2)}

# Form Elements
${JSON.stringify(pageContext.formElements, null, 2)}

Based on this information, suggest 3-5 specific actions the user could take on this page.
Format your response as a JSON object with a "suggestions" array containing strings of suggested actions, focusing on what would be most useful for the user.

You must respond with a valid JSON object. Use this exact format:
{
  "suggestions": [
    "Search for specific content using the search bar",
    "Click on the login button to access your account",
    "Filter content by category using the dropdown menu"
  ]
}
`,
          },
        ],
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const response = JSON.parse(chat.choices[0].message.content);

      // Ensure we have a consistent response format
      const suggestions =
        response.suggestions ||
        response.actions ||
        response.suggestedActions ||
        [];

      return {
        action: "suggest_action",
        suggestions: Array.isArray(suggestions) ? suggestions : [suggestions],
      };
    } catch (error) {
      console.error("Error generating suggested actions:", error);
      return {
        action: "suggest_action",
        suggestions: ["Error generating suggestions: " + error.message],
      };
    }
  }

  /**
   * Generate a summary of the current page
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Promise<Object>} Action with page summary
   */
  async generatePageSummary(pageSnapshot = {}) {
    console.log("Generating page summary");

    try {
      const pageContext = this.preparePageContext(pageSnapshot);

      const systemPrompt = `You are an AI browser assistant that provides concise summaries of webpages.
      Your task is to create a brief, informative summary of what this page is about.
      Focus on the main purpose of the page and its primary content.
      Keep your summary to 1-2 sentences that clearly explain what this page is and what it's for.
      
      IMPORTANT: Return your response as a JSON object with a "summary" field containing your summary text.`;

      const chat = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Here is information about the current webpage:
            
URL: ${pageContext.url}
Title: ${pageContext.title}

# Page Structure
${JSON.stringify(pageContext.headings, null, 2)}

# Page Content Preview
${JSON.stringify(pageContext.clickableElements?.slice(0, 10), null, 2)}

Please provide a concise 1-2 sentence summary of what this page is and what it's for.
You must respond with a valid JSON object. Use this exact format:

{
  "summary": "This is the YouTube homepage, where users can browse and watch recommended videos across various topics and genres."
}
`,
          },
        ],
        max_tokens: 200,
        response_format: { type: "json_object" },
      });

      const response = JSON.parse(chat.choices[0].message.content);

      // Ensure we have a consistent response format
      const summary =
        response.summary ||
        response.pageSummary ||
        response.description ||
        "This appears to be " + (pageContext.title || "a webpage") + ".";

      return {
        action: "summary_page",
        summary,
      };
    } catch (error) {
      console.error("Error generating page summary:", error);
      return {
        action: "summary_page",
        summary: "Error generating summary: " + error.message,
      };
    }
  }

  /**
   * Generate a detailed description of the page content
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Promise<Object>} Action with content description
   */
  async generateContentDescription(pageSnapshot = {}) {
    console.log("Generating content description");

    try {
      const pageContext = this.preparePageContext(pageSnapshot);

      const systemPrompt = `You are an AI browser assistant that helps users understand what content is on a webpage.
      Your task is to provide a detailed description of the main content items visible on the page.
      For example, if it's YouTube, describe the actual videos shown (titles, channels).
      If it's a news site, describe the specific articles and headlines visible.
      Focus on the actual content rather than the page structure or navigation elements.
      
      IMPORTANT: Return your response as a JSON object with a "description" field containing your detailed content description.`;

      const chat = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Here is information about the current webpage:
            
URL: ${pageContext.url}
Title: ${pageContext.title}

# Page Structure
${JSON.stringify(pageContext.headings, null, 2)}

# Page Content
${JSON.stringify(pageContext.clickableElements, null, 2)}

Please describe the specific content items visible on this page. For example:
- If it's YouTube: List several video titles and channels that are visible
- If it's a news site: List the main headlines and articles
- If it's a product page: Describe the product details shown

Focus on the actual content the user would be interested in, not the page layout or navigation elements.

You must respond with a valid JSON object. Use this exact format:
{
  "description": "Your detailed description of the page content goes here..."
}
`,
          },
        ],
        max_tokens: 600,
        response_format: { type: "json_object" },
      });

      const response = JSON.parse(chat.choices[0].message.content);

      // Ensure we have a consistent response format
      const description =
        response.description ||
        response.contentDescription ||
        response.content ||
        "Unable to describe specific content on this page.";

      return {
        action: "describe_content",
        description,
      };
    } catch (error) {
      console.error("Error generating content description:", error);
      return {
        action: "describe_content",
        description: "Error describing content: " + error.message,
      };
    }
  }

  /**
   * Helper to prepare page context for AI processing
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Object} Formatted page context
   */
  preparePageContext(pageSnapshot = {}) {
    const pageContent = pageSnapshot.content || {};

    // Build a structured overview of the page
    const pageContext = {
      url: pageSnapshot.url || "about:blank",
      title: pageSnapshot.title || "",
    };

    // Include detailed page structure for context
    if (pageSnapshot.elements) {
      pageContext.clickableElements = pageSnapshot.elements
        .filter((el) =>
          ["a", "button", "input", "div", "span", "img"].includes(el.tag)
        )
        .map((el) => ({
          tag: el.tag,
          text: el.text || "",
          id: el.id,
          classes: el.classes,
          selector: el.selector,
          ariaLabel: el.ariaLabel,
          type: el.type,
        }))
        .slice(0, 30);

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

    return pageContext;
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

      // Clean up the site name - remove any trailing periods
      const cleanSite = site.replace(/\.+$/, "");

      // Check if it contains a TLD (dots between characters)
      if (cleanSite.includes(".") && !cleanSite.endsWith(".")) {
        return `https://${cleanSite}`;
      }

      // Otherwise assume it's a well-known site
      return `https://www.${cleanSite}.com`;
    }

    // Default to a search if we can't parse it
    return `https://www.google.com/search?q=${encodeURIComponent(command)}`;
  }
}

module.exports = AIConnector;
