const engineRunnerService = require("./engine-runner.service");
const historyService = require("./history.service");
const userPreferencesRepository = require("../repositories/user-preferences.repository");
const { getTradingMode } = require("../config/trading-modes");

const DEFAULT_PREFERENCES = {
  trading_mode: "balanced",
  preferred_symbols: ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD"],
  ai_explanations_enabled: true,
  notifications_enabled: true,
  panel_layout: "default",
  theme: "dark"
};

function buildSignalPriority(confidence = 0) {
  if (confidence >= 90) return "Máxima";
  if (confidence >= 82) return "Alta";
  if (confidence >= 74) return "Moderada";
  return "Observação";
}

function buildDisplayStatus(bestOpportunity) {
  if (!bestOpportunity) {
    return {
      label: "AGUARDANDO",
      signal: "WAIT"
    };
  }

  if (bestOpportunity.signal === "CALL") {
    return {
      label: "CALL",
      signal: "CALL"
    };
  }

  if (bestOpportunity.signal === "PUT") {
    return {
      label: "PUT",
      signal: "PUT"
    };
  }

  return {
    label: "AGUARDANDO",
    signal: "WAIT"
  };
}

async function getUserDashboard(userId) {
  const runtime = engineRunnerService.getState();
  const preferences =
    (await userPreferencesRepository.findByUserId(userId)) || DEFAULT_PREFERENCES;

  const modeConfig = getTradingMode(preferences.trading_mode);
  const bestOpportunity = runtime.bestOpportunity || null;
  const recentHistory = historyService.getLatest(12);
  const historyStats = historyService.getStats();
  const displayStatus = buildDisplayStatus(bestOpportunity);

  const trackedSymbols = Array.isArray(runtime.trackedSymbols)
    ? runtime.trackedSymbols
    : DEFAULT_PREFERENCES.preferred_symbols;

  return {
    platform: {
      name: "AERIX",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString()
    },
    connection: {
      apiOnline: true,
      engineRunning: runtime.isRunning,
      engineProcessing: runtime.isProcessing,
      lastCycleAt: runtime.lastCycleAt,
      rateLimit: runtime.rateLimit
    },
    user: {
      id: userId,
      preferences: {
        ...preferences,
        mode_config: modeConfig
      }
    },
    signalCenter: {
      status: displayStatus.label,
      signal: displayStatus.signal,
      priority: buildSignalPriority(bestOpportunity?.confidence || 0),
      bestOpportunity,
      trackedSymbols
    },
    ranking: runtime.latestResults || [],
    history: recentHistory,
    analytics: {
      historyStats
    }
  };
}

module.exports = {
  getUserDashboard
};