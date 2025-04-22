require("dotenv").config();
const { app } = require("electron");
const path = require("path");

// Just require our main module - all initialization happens there
require("./src/main");
