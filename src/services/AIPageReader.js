const OpenAI = require("openai");

class AIPageReader {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Generate a page explanation for visually impaired users
   * @param {Object} pageSnapshot - The captured page data
   * @returns {Promise<Object>} An explanation object with summary and actions
   */
  async explainPage(pageSnapshot = {}) {
    try {
      const systemPrompt = `You are an AI screen reader assistant designed to help visually impaired users. Your task is to:
1. Explain the current webpage in a clear, concise manner
2. Identify the main purpose of the page
3. Describe the specific content on the page in detail (e.g., if on YouTube, describe what videos are shown)
4. Suggest 3-5 actions the user could take on this page

Focus on describing the actual content the user would want to know about (specific videos, articles, products), rather than just the page structure. Be helpful and empathetic.

Return your response as a JSON object with the following fields:
- summary: A concise overview of the page
- mainPurpose: The primary function of this page
- contentDetails: Detailed description of what content is shown on the page
- suggestedActions: Array of actions the user could take`;

      // Create a concise representation of the page
      const pageContext = {
        url: pageSnapshot.url || "about:blank",
        title: pageSnapshot.title || "",
        viewport: pageSnapshot.viewport || { width: 0, height: 0 },
      };

      // Include page elements for context
      if (pageSnapshot.elements) {
        // Filter to most important elements for readability
        pageContext.elements = pageSnapshot.elements
          .filter((el) => {
            // Include main navigation, headings, forms, and key interactive elements
            const isImportant =
              el.tag === "h1" ||
              el.tag === "h2" ||
              el.tag === "nav" ||
              (el.tag === "a" && el.text && el.text.length > 1) ||
              el.tag === "button" ||
              el.tag === "form" ||
              el.tag === "input" ||
              el.role === "navigation" ||
              el.role === "banner" ||
              el.role === "main";
            return isImportant;
          })
          .map((el) => ({
            tag: el.tag,
            text: el.text || "",
            role: el.role,
            type: el.type,
            placeholder: el.placeholder,
            ariaLabel: el.ariaLabel,
          }))
          .slice(0, 40);
      }

      // Include headings for structure
      if (pageSnapshot.headings) {
        pageContext.headings = pageSnapshot.headings;
      }

      console.log("Generating page explanation for:", pageContext.url);

      const chat = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Please explain this webpage in a way that's helpful for a visually impaired user:

Page information: ${JSON.stringify(pageContext, null, 2)}

Your explanation should include:
1. A brief overview of what this page is about
2. The main content and functional areas of the page
3. Detailed description of the specific content shown (e.g., for YouTube - what videos are shown, their titles, artists, etc.)
4. 3-5 suggested actions the user could take

Return the information in a JSON format with these properties:
- summary: A concise overview of the page
- mainPurpose: The primary function of this page
- contentDetails: Detailed description of what content is shown on the page
- suggestedActions: Array of actions the user could take

Example format:
{
  "summary": "This is the YouTube homepage showing trending videos.",
  "mainPurpose": "To browse and watch popular YouTube videos",
  "contentDetails": "The page displays 5 trending videos including 'Tutorial: How to Code', 'Latest News Update', etc.",
  "suggestedActions": [
    "Click on the first video to watch it",
    "Use the search bar to find specific content",
    "Browse categories in the sidebar"
  ]
}
`,
          },
        ],
        max_tokens: 800,
        response_format: { type: "json_object" },
      });

      const responseContent = chat.choices[0].message.content;
      console.log("Generated page explanation");

      try {
        // Parse the JSON response
        const parsedResponse = JSON.parse(responseContent);
        return parsedResponse;
      } catch (err) {
        console.error("Failed to parse page explanation JSON:", err);
        return {
          summary: "Unable to generate page explanation",
          mainPurpose: "Error processing page content",
          contentDetails: "Could not analyze the page content",
          suggestedActions: ["Reload the page and try again"],
        };
      }
    } catch (error) {
      console.error("Error generating page explanation:", error);
      throw error;
    }
  }
}

module.exports = AIPageReader;
