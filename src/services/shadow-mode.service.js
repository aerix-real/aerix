const shadowModeRepository = require("../repositories/shadow-mode.repository");

async function recordBlockedSignal(blockedSignal, originalSignal, { source = "engine", blockEvents = [] } = {}) {
  return shadowModeRepository.recordShadowBlock({
    blockedSignal,
    originalSignal,
    source,
    blockEvents
  });
}

async function getShadowModeMetrics(options = {}) {
  return shadowModeRepository.getSummary(options);
}

module.exports = {
  recordBlockedSignal,
  getShadowModeMetrics,
  getExpiredPending: shadowModeRepository.getExpiredPending,
  finalizeShadowResult: shadowModeRepository.finalizeShadowResult
};
