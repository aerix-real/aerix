const filterAnalyticsRepository = require("../repositories/filter-analytics.repository");

async function recordBlockedSignal(signal, source) {
  return filterAnalyticsRepository.recordBlockedSignal(signal, source);
}

async function getFilterAnalytics(options = {}) {
  return filterAnalyticsRepository.getSummary(options);
}

module.exports = {
  recordBlockedSignal,
  getFilterAnalytics
};
