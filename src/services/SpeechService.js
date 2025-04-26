const speech = require("@google-cloud/speech");

class SpeechService {
  constructor() {
    // Instantiates a client
    this.client = new speech.SpeechClient();
  }

  /**
   * Transcribe base64-encoded audio using Google Cloud Speech-to-Text
   * @param {string} audioBase64 - The audio data in base64
   * @param {string} [languageCode='en-US'] - The language of the audio
   * @returns {Promise<string>} The transcript
   */
  async transcribeAudio(audioBase64, languageCode = "en-US") {
    // Decode base64 into buffer
    const audioBuffer = Buffer.from(audioBase64, "base64");

    const audio = {
      content: audioBuffer.toString("base64"),
    };
    const config = {
      encoding: "WEBM_OPUS",
      sampleRateHertz: 48000,
      languageCode,
      model: "default",
      enableAutomaticPunctuation: true,
    };
    const request = {
      audio,
      config,
    };

    const [response] = await this.client.recognize(request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join("\n");

    return transcription;
  }
}

module.exports = SpeechService;
