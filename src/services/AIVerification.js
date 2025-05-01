const OpenAI = require("openai");

/**
 * Class to verify if a command has been satisfied by the current page state
 */
class AIVerification {
  constructor(openai) {
    this.openai = openai;
  }

  /**
   * Check if the command has been satisfied based on the current page state
   * @param {string} command - The original command
   * @param {Object} pageSnapshot - The current page snapshot
   * @returns {Promise<{satisfied: boolean, confidence: number, reason: string}>} - Verification result
   */
  async check(command, pageSnapshot) {
    try {
      const pageContext = this.preparePageContext(pageSnapshot);
      const pageContent = pageSnapshot.content || {};
      const pageText =
        pageContent.text || pageSnapshot.fullText || "No page text available";

      // Prepare prompt for OpenAI
      const systemPrompt = this.getSystemPrompt();
      const userContent = this.generateUserContent(
        command,
        pageContext,
        pageText
      );

      console.log("Verifying if command is satisfied:", command);
      console.log("Page context URL:", pageContext.url);

      const response = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);
      console.log("Verification result:", result);

      return {
        satisfied: result.satisfied || false,
        confidence: result.confidence || 0,
        reason: result.reason || "No reason provided",
      };
    } catch (error) {
      console.error("Error verifying command satisfaction:", error);
      // Default to not satisfied on error, to ensure command execution continues
      return {
        satisfied: false,
        confidence: 0,
        reason: `Error during verification: ${error.message}`,
      };
    }
  }

  /**
   * Get system prompt for command verification
   * @returns {string} The system prompt
   */
  getSystemPrompt() {
    return `You are an AI verification agent. Your task is to determine if a user's command has been satisfied by the current page state.

For example:
- If the command was "go to YouTube" and the current page is YouTube, the command is satisfied
- If the command was "click on sign in" and sign-in options are visible, the command might be satisfied
- If the command was "search for videos about cats" and search results for cats are shown, the command is satisfied

Analyze the command intent, the current page URL, title, and visible content to make your determination.

IMPORTANT: Return a JSON object with three fields:
1. "satisfied": boolean - true if the command appears to be satisfied, false otherwise
2. "confidence": number - a score from 0 to 1 indicating your confidence level
3. "reason": string - a brief explanation of your determination

Example responses:
{"satisfied": true, "confidence": 0.9, "reason": "The page shows search results for 'cats' as requested"}
{"satisfied": false, "confidence": 0.8, "reason": "The user wanted to see cat videos but the page shows dog videos"}`;
  }

  /**
   * Generate user content for verification prompt
   * @param {string} command - The original command
   * @param {Object} pageContext - The prepared page context
   * @param {string} pageText - The page text
   * @returns {string} The user content
   */
  generateUserContent(command, pageContext, pageText) {
    return `Original command: "${command}"

Current page state:
URL: ${pageContext.url}
Title: ${pageContext.title}

Page heading structure:
${JSON.stringify(pageContext.headings || [], null, 2)}

Visible elements (sample):
${JSON.stringify(pageContext.clickableElements?.slice(0, 10) || [], null, 2)}

Page text sample:
${pageText.length > 1000 ? pageText.substring(0, 1000) + "..." : pageText}

Determine if the command has been satisfied by the current page state.
Return only a JSON object with "satisfied" (boolean), "confidence" (number 0-1), and "reason" (string) fields.`;
  }

  /**
   * Helper to prepare page context for AI processing
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Object} Formatted page context
   */
  preparePageContext(pageSnapshot = {}) {
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
    } else {
      // Fallback to old format if necessary
      const pageContent = pageSnapshot.content || {};
      pageContext.a11yTree = pageContent.a11yTree || [];
      pageContext.headings = pageContent.headings || [];
      pageContext.buttons = pageContent.buttons || [];
    }

    return pageContext;
  }
}

module.exports = AIVerification;
