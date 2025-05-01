const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

/**
 * Class to handle AI-based action determination
 */
class AIDetermineAction {
  constructor(openai) {
    this.openai = openai;
  }

  /**
   * Get system prompt for AI
   * @returns {string} The system prompt for the AI
   */
  getSystemPrompt() {
    return `You are an AI browser automation agent. Receive a natural language command and the current page content, then output a SINGLE action step in JSON format. The step should have 'action', 'selector', and optional 'value' or 'url'.

Allowed actions:
- navigate: requires url parameter
- click: requires selector parameter 
- type: requires selector and value parameters
- scroll: requires value parameter (positive for down, negative for up)
- suggest_action: provides suggestions based on the page content
- summary_page: provides a summary of the current page
- describe_content: provides detailed description of the page content
- display_answer: provides answer to a question based on page content

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
10. When the user asks a question about the page content (like "who is the author of this article?"), use the "display_answer" action.

ELEMENT SELECTION PRIORITY:
1. First try to find elements with exact text matches in their innerText, textContent, title, aria-label, or alt attributes
2. Next, try to find elements containing partial text matches
3. For videos on YouTube, look for title elements, video thumbnails, or link elements

For selectors, use the most specific and reliable CSS selector. Prefer using IDs, then unique classes, then more complex selectors if needed. For accessibility, also consider using XPath selectors when appropriate.

IMPORTANT: Only return a SINGLE action step that can be executed immediately, not a full plan or sequence of steps. This should be the next logical action based on the command and current page state.`;
  }

  /**
   * Extract relevant content chunks from page text based on prompt keywords
   * @param {string} command - The user command
   * @param {string} pageText - The full page text
   * @param {number} chunkSize - Words to include around each match (default: 100)
   * @returns {string} Filtered page text with relevant chunks
   */
  extractRelevantContent(command, pageText, chunkSize = 100) {
    if (!command || !pageText || pageText.length < 50) {
      return pageText;
    }

    // Extract both individual words and phrases from command
    const stopWords = [
      "a",
      "an",
      "the",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "with",
    ];
    const actionWords = ["click", "search", "go", "find", "open", "get"];

    // Clean up command - remove action verbs from the beginning
    let cleanCommand = command.toLowerCase();
    for (const action of actionWords) {
      if (cleanCommand.startsWith(action)) {
        cleanCommand = cleanCommand.replace(new RegExp(`^${action}\\s+`), "");
        break;
      }
    }

    // Get individual keywords (excluding stop words)
    const keywords = cleanCommand
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 2 &&
          !stopWords.includes(word) &&
          !actionWords.includes(word)
      );

    // Also get multi-word phrases (2-3 word combinations)
    const commandWords = cleanCommand.split(/\s+/);
    const phrases = [];

    // Add 2-word phrases
    for (let i = 0; i < commandWords.length - 1; i++) {
      phrases.push(commandWords.slice(i, i + 2).join(" "));
    }

    // Add 3-word phrases if command is long enough
    if (commandWords.length >= 3) {
      for (let i = 0; i < commandWords.length - 2; i++) {
        phrases.push(commandWords.slice(i, i + 3).join(" "));
      }
    }

    // Also add the entire command as a potential phrase to match
    if (cleanCommand.split(/\s+/).length >= 2) {
      phrases.push(cleanCommand);
    }

    if (keywords.length === 0 && phrases.length === 0) {
      return pageText; // No significant keywords found
    }

    // Split page text into words for word-level matching
    const words = pageText.split(/\s+/);
    const chunks = new Set();

    // For each keyword, find matches and extract chunks
    for (const keyword of keywords) {
      for (let i = 0; i < words.length; i++) {
        if (words[i].toLowerCase().includes(keyword)) {
          // Found a match, extract chunk around it
          const start = Math.max(0, i - Math.floor(chunkSize / 2));
          const end = Math.min(words.length, i + Math.floor(chunkSize / 2));
          const chunk = words.slice(start, end).join(" ");
          chunks.add(chunk);
        }
      }
    }

    // For each phrase, find matches in the full text
    for (const phrase of phrases) {
      // Using regex to find the phrase in the full text
      const phraseRegex = new RegExp(
        `\\b${phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`,
        "i"
      );
      if (phraseRegex.test(pageText)) {
        // Find each occurrence of the phrase
        let match;
        let phraseRegexGlobal = new RegExp(
          `\\b${phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`,
          "gi"
        );

        while ((match = phraseRegexGlobal.exec(pageText)) !== null) {
          // Extract context around the match
          const matchIndex = match.index;
          const matchLength = match[0].length;

          // Find word boundaries to extract ~chunkSize words around match
          const beforeText = pageText.substring(0, matchIndex);
          const afterText = pageText.substring(matchIndex + matchLength);

          // Count ~chunkSize/2 words before
          const wordsBeforeCount = Math.floor(chunkSize / 2);
          let beforeChunk = beforeText
            .split(/\s+/)
            .slice(-wordsBeforeCount)
            .join(" ");

          // Count ~chunkSize/2 words after
          const wordsAfterCount = Math.floor(chunkSize / 2);
          let afterChunk = afterText
            .split(/\s+/)
            .slice(0, wordsAfterCount)
            .join(" ");

          const fullChunk = `${beforeChunk} ${match[0]} ${afterChunk}`.trim();
          chunks.add(fullChunk);
        }
      }
    }

    // If no chunks found, return a portion of the original text
    if (chunks.size === 0) {
      return pageText.length > 1000
        ? pageText.substring(0, 1000) + "..."
        : pageText;
    }

    // Join all unique chunks with a separator for clarity
    return Array.from(chunks).join("\n\n--- Relevant Content Section ---\n\n");
  }

  /**
   * Generate user message content for the AI
   * @param {string} command - The user command
   * @param {Object} pageContext - The prepared page context
   * @param {string} pageText - The page text
   * @returns {string} The user message content
   */
  generateUserMessageContent(command, pageContext, pageText) {
    return `Command: ${command}

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

Please return a single action in JSON format that best accomplishes this command on the current page.`;
  }

  /**
   * Determine the action based on command and page context
   * @param {string} command - The user command
   * @param {Object} pageContext - The prepared page context
   * @param {string} pageText - The page text
   * @returns {Promise<Object>} The response from OpenAI
   */
  async determine(command, pageContext, pageText) {
    const systemPrompt = this.getSystemPrompt();

    // Process page text to extract relevant chunks based on command keywords
    const processedPageText = this.extractRelevantContent(command, pageText);

    // Add debug logging to show extraction results
    console.log(
      `Original page text length: ${pageText.length}, Processed text length: ${processedPageText.length}`
    );
    if (pageText.length > processedPageText.length) {
      console.log(
        `Content reduced by ${(
          100 -
          (processedPageText.length / pageText.length) * 100
        ).toFixed(2)}%`
      );
    }

    const userContent = this.generateUserMessageContent(
      command,
      pageContext,
      processedPageText
    );

    console.log("Sending command to OpenAI:", command);
    console.log("Page context URL:", pageContext.url);

    const chat = await this.openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "developer", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 500,
      response_format: { type: "json_object" },
    });
    return chat.choices[0].message.content;
  }
}

class AIConnector {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
    this.aiDetermineAction = new AIDetermineAction(this.openai);
  }

  /**
   * Determine if command matches specific action keywords
   * @param {string} command - The user command
   * @returns {string|null} Action type or null if no match
   */
  determineCommandIntent(command) {
    const lowerCommand = command.toLowerCase();

    if (
      lowerCommand.includes("suggest") ||
      lowerCommand.includes("what can i do")
    ) {
      return "suggest_action";
    }

    if (
      lowerCommand.includes("summarize") ||
      lowerCommand.includes("summary")
    ) {
      return "summary_page";
    }

    if (
      lowerCommand.includes("describe content") ||
      lowerCommand.includes("what's on this page")
    ) {
      return "describe_content";
    }

    if (lowerCommand.includes("go to")) {
      return "navigate";
    }

    // Check if the command is a question
    if (
      lowerCommand.includes("?") ||
      lowerCommand.startsWith("what") ||
      lowerCommand.startsWith("who") ||
      lowerCommand.startsWith("where") ||
      lowerCommand.startsWith("when") ||
      lowerCommand.startsWith("why") ||
      lowerCommand.startsWith("how") ||
      lowerCommand.startsWith("can") ||
      lowerCommand.startsWith("does") ||
      lowerCommand.startsWith("is") ||
      lowerCommand.startsWith("are")
    ) {
      return "answer_question";
    }

    return null;
  }

  /**
   * Prepare YouTube-specific element info
   * @param {Object} el - The element
   * @param {boolean} isYouTube - Whether the page is YouTube
   * @returns {Object} Enhanced element info
   */
  prepareElementInfo(el, isYouTube) {
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
          (el.ariaLabel.includes("video") || el.ariaLabel.includes("watch")));

      if (isVideoElement) {
        elementInfo.isVideoElement = true;
      }
    }

    return elementInfo;
  }

  /**
   * Prepare context from page snapshot
   * @param {Object} pageSnapshot - The page snapshot data
   * @returns {Object} Prepared context for the AI
   */
  prepareAIContext(pageSnapshot) {
    // Use the existing preparePageContext method for consistency
    const pageContext = this.preparePageContext(pageSnapshot);

    // If we need YouTube-specific enhancements for clickable elements
    if (pageSnapshot.elements && pageContext.clickableElements) {
      const isYouTube = pageContext.url.includes("youtube.com");

      // Replace the clickable elements with enhanced versions that include YouTube-specific flags
      pageContext.clickableElements = pageSnapshot.elements
        .filter((el) =>
          ["a", "button", "input", "div", "span", "img"].includes(el.tag)
        )
        .map((el) => this.prepareElementInfo(el, isYouTube))
        .slice(0, 30);
    }

    return pageContext;
  }

  /**
   * Generate user message content for the AI
   * @param {string} command - The user command
   * @param {Object} pageContext - The prepared page context
   * @param {string} pageText - The page text
   * @returns {string} The user message content
   */
  generateUserMessageContent(command, pageContext, pageText) {
    return `Command: ${command}

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

Please return a single action in JSON format that best accomplishes this command on the current page.`;
  }

  /**
   * Process response from OpenAI and route to appropriate handler
   * @param {string} responseContent - The response content
   * @param {Object} pageSnapshot - The page snapshot data
   * @returns {Promise<Object>} The processed action
   */
  async processOpenAIResponse(responseContent, pageSnapshot) {
    try {
      // Parse the JSON response
      const parsedResponse = JSON.parse(responseContent);

      // Validate that we have an action
      if (!parsedResponse.action) {
        throw new Error("Response missing 'action' property");
      }

      const action = parsedResponse.action;

      // Route to appropriate handler based on action
      switch (action) {
        case "describe_content":
          return await this.generateContentDescription(pageSnapshot);

        case "summary_page":
          return await this.generatePageSummary(pageSnapshot);

        case "display_answer":
          return await this.generateQuestionAnswer(
            parsedResponse.question,
            pageSnapshot
          );

        case "navigate":
          // Ensure URL is properly formatted
          if (
            !parsedResponse.url.startsWith("http://") &&
            !parsedResponse.url.startsWith("https://")
          ) {
            parsedResponse.url = `https://${parsedResponse.url}`;
          }
          return parsedResponse;

        case "click":
          // Ensure selector is valid
          if (parsedResponse.selector.includes(":contains(")) {
            throw new Error(
              "Invalid selector: ':contains()' is not a valid CSS selector"
            );
          }
          return parsedResponse;

        case "type":
          // Ensure value is a string
          if (typeof parsedResponse.value !== "string") {
            parsedResponse.value = String(parsedResponse.value);
          }
          return parsedResponse;

        case "scroll":
          // Ensure value is a number
          const value = Number(parsedResponse.value);
          if (isNaN(value)) {
            throw new Error("Scroll value must be a number");
          }
          parsedResponse.value = value;
          return parsedResponse;

        case "suggest_action":
          // Ensure suggestions is an array
          if (!Array.isArray(parsedResponse.suggestions)) {
            parsedResponse.suggestions = [parsedResponse.suggestions];
          }
          return parsedResponse;

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (err) {
      console.error("Error processing OpenAI response:", err);
      throw new Error(
        `Failed to process action: ${err.message}. Response content: ${responseContent}`
      );
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
      // Step 2: Prepare the page context and text
      const pageContext = this.prepareAIContext(pageSnapshot);
      const pageContent = pageSnapshot.content || {};

      // Get full page text if available, or a snippet
      let pageText = "";
      if (pageContent.text) {
        // Use full text instead of just a snippet for better content extraction
        pageText = pageContent.text;
      } else if (pageSnapshot.fullText) {
        pageText = pageSnapshot.fullText;
      } else {
        pageText = "No page text available";
      }

      // Step 3: Call OpenAI API through the AIDetermineAction class
      const responseContent = await this.aiDetermineAction.determine(
        command,
        pageContext,
        pageText
      );
      console.log("Response content:", responseContent);

      // Step 4: Process the API response
      return await this.processOpenAIResponse(responseContent, pageSnapshot);
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

      console.log("Chat response:", chat.choices[0].message.content);

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

  /**
   * Generate an answer to a user question based on page content
   * @param {string} question - The user's question
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Promise<Object>} Action with answer
   */
  async generateQuestionAnswer(question, pageSnapshot = {}) {
    console.log("Generating answer to question:", question);

    try {
      const pageContext = this.preparePageContext(pageSnapshot);

      const systemPrompt = `You are an AI browser assistant that answers questions about webpage content.
      Your task is to provide a clear, accurate, and concise answer to the user's question based on the content visible on the current page.
      Focus on extracting relevant information from the page context provided.
      If the answer cannot be determined from the available information, acknowledge that and suggest what might help.
      
      IMPORTANT: Return your response as a JSON object with an "answer" field containing your answer to the question.`;

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

The user has asked the following question:
"${question}"

Please provide a clear and concise answer based on the page content shown above.
If you cannot answer based on the available information, explain what information is missing.

You must respond with a valid JSON object. Use this exact format:
{
  "answer": "Your detailed answer to the question goes here..."
}
`,
          },
        ],
        max_tokens: 800,
        response_format: { type: "json_object" },
      });

      let response;
      try {
        response = JSON.parse(chat.choices[0].message.content);
      } catch (parseError) {
        console.error("Error parsing JSON response:", parseError);
        response = {};
      }

      // Ensure we have a consistent response format
      const answer =
        response.answer ||
        response.response ||
        response.content ||
        "I'm unable to answer this question based on the current page content.";

      return {
        action: "display_answer",
        question,
        answer,
      };
    } catch (error) {
      console.error("Error generating question answer:", error);
      return {
        action: "display_answer",
        question,
        answer: "Error answering question: " + error.message,
      };
    }
  }
}

module.exports = AIConnector;
