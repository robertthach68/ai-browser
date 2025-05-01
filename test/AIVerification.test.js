const { describe, it, beforeEach, afterEach } = require("mocha");
const { expect } = require("chai");
const sinon = require("sinon");
const AIVerification = require("../src/services/AIVerification");

describe("AIVerification", () => {
  let aiVerification;
  let mockOpenAI;

  beforeEach(() => {
    // Mock OpenAI
    mockOpenAI = {
      chat: {
        completions: {
          create: sinon.stub(),
        },
      },
    };

    aiVerification = new AIVerification(mockOpenAI);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("check", () => {
    it("should return the parsed verification result when command is satisfied", async () => {
      // Mock OpenAI response
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                satisfied: true,
                confidence: 0.9,
                reason: "The page shows YouTube homepage as requested",
              }),
            },
          },
        ],
      };
      mockOpenAI.chat.completions.create.resolves(mockResponse);

      // Test data
      const command = "go to YouTube";
      const pageSnapshot = {
        url: "https://www.youtube.com",
        title: "YouTube",
        elements: [
          { tag: "a", text: "Home", selector: "#home" },
          { tag: "a", text: "Trending", selector: "#trending" },
        ],
      };

      // Execute
      const result = await aiVerification.check(command, pageSnapshot);

      // Verify
      expect(result).to.deep.equal({
        satisfied: true,
        confidence: 0.9,
        reason: "The page shows YouTube homepage as requested",
      });
      expect(mockOpenAI.chat.completions.create.calledOnce).to.be.true;
    });

    it("should return not satisfied with low confidence on error", async () => {
      // Mock OpenAI error
      mockOpenAI.chat.completions.create.rejects(new Error("API error"));

      // Test data
      const command = "go to YouTube";
      const pageSnapshot = {
        url: "https://www.example.com",
        title: "Example",
      };

      // Execute
      const result = await aiVerification.check(command, pageSnapshot);

      // Verify
      expect(result).to.deep.equal({
        satisfied: false,
        confidence: 0,
        reason: "Error during verification: API error",
      });
    });

    it("should handle malformed JSON response from OpenAI", async () => {
      // Mock OpenAI response with invalid JSON
      const mockResponse = {
        choices: [
          {
            message: {
              content: "Not a valid JSON response",
            },
          },
        ],
      };
      mockOpenAI.chat.completions.create.resolves(mockResponse);

      // Test data
      const command = "search for cats";
      const pageSnapshot = {
        url: "https://www.google.com",
        title: "Google",
      };

      // Execute
      const result = await aiVerification.check(command, pageSnapshot);

      // Verify
      expect(result.satisfied).to.be.false;
      expect(result.confidence).to.equal(0);
      expect(result.reason).to.include("Error during verification");
    });
  });
});
