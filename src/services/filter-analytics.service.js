const filterAnalyticsRepository = require("../repositories/filter-analytics.repository");

async function recordBlockedSignal(signal, source) {
  return filterAnalyticsRepository.recordBlockedSignal(signal, source);
}

async function recordFilterEfficiency(signal, source) {
  return filterAnalyticsRepository.recordFilterEfficiency(signal, source);
}

async function getFilterAnalytics(options = {}) {
  return filterAnalyticsRepository.getSummary(options);
}

async function getFilterEfficiency(options = {}) {
  return filterAnalyticsRepository.getEfficiencySummary(options);
}

module.exports = {
  recordBlockedSignal,
  recordFilterEfficiency,
  getFilterAnalytics,
  getFilterEfficiency
};
