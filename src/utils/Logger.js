const fs = require("fs");
const path = require("path");
const { app } = require("electron");

class Logger {
  constructor() {
    this.logPath = path.join(app.getPath("userData"), "actions.log");
  }

  /**
   * Log an action to the log file
   * @param {Object} record - The action record to log
   */
  logAction(record) {
    try {
      const redacted = { ...record };

      // Redact sensitive information like passwords
      if (
        record.action === "type" &&
        record.selector &&
        record.selector.toLowerCase().includes("password")
      ) {
        redacted.value = "REDACTED";
      }

      const entry = {
        ...redacted,
        timestamp: new Date().toISOString(),
      };

      fs.appendFile(this.logPath, JSON.stringify(entry) + "\n", (err) => {
        if (err) console.error("Failed to log action:", err);
      });
    } catch (error) {
      console.error("Error logging action:", error);
    }
  }

  /**
   * Get the log file path
   * @returns {string} The log file path
   */
  getLogPath() {
    return this.logPath;
  }

  /**
   * Read the recent log entries
   * @param {number} limit - Maximum number of entries to return
   * @returns {Promise<Array>} Recent log entries
   */
  async getRecentLogs(limit = 50) {
    return new Promise((resolve, reject) => {
      fs.readFile(this.logPath, "utf8", (err, data) => {
        if (err) {
          if (err.code === "ENOENT") {
            resolve([]); // No log file exists yet
          } else {
            reject(err);
          }
          return;
        }

        try {
          const lines = data.trim().split("\n");
          const logs = lines
            .filter((line) => line.trim() !== "")
            .map((line) => JSON.parse(line))
            .slice(-limit); // Get the most recent entries

          resolve(logs);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Clear the log file
   * @returns {Promise<void>}
   */
  async clearLogs() {
    return new Promise((resolve, reject) => {
      fs.writeFile(this.logPath, "", (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = Logger;
