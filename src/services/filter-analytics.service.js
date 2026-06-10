const filterAnalyticsRepository = require("../repositories/filter-analytics.repository");

async function recordBlockedSignal(signal, source) {
  return filterAnalyticsRepository.recordBlockedSignal(signal, source);
}

async function recordSignalFilters(signal, source) {
  return filterAnalyticsRepository.recordSignalFilters(signal, source);
}

async function updateShadowOutcomes(signal, resultOutcome) {
  return filterAnalyticsRepository.updateShadowOutcomes(signal, resultOutcome);
}

async function getFilterAnalytics(options = {}) {
  return filterAnalyticsRepository.getSummary(options);
}

module.exports = {
  recordBlockedSignal,
  recordSignalFilters,
  updateShadowOutcomes,
  getFilterAnalytics
};
