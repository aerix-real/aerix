const env = require("../config/env");

function log(...args) {
  if (env.app.debug) {
    console.log("[AERIX]", ...args);
  }
}

function warn(...args) {
  console.warn("[AERIX][WARN]", ...args);
}

function error(...args) {
  console.error("[AERIX][ERROR]", ...args);
}

module.exports = {
  log,
  warn,
  error
};