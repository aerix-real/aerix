const {
  getMinimumValidatedScore,
  getSignalDirection,
  getSignalScore,
  isConfirmedOperationalSignal
} = require("../utils/signal-history-filter");

const MAX_EVENTS = Number(process.env.ENGINE_DEBUG_MAX_EVENTS || 250);

const debugState = {
  analyzed: 0,
  approved: 0,
  blocked: 0,
  topBlockReasons: {},
  recentEvents: [],
  startedAt: new Date().toISOString(),
  updatedAt: null
};

function emitStructuredLog(event, payload = {}) {
  const log = {
    scope: "aerix_engine_debug",
    event,
    timestamp: new Date().toISOString(),
    ...payload
  };

  console.log(JSON.stringify(log));
}


function normalizeOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getLoggedMinimumScore(signal = {}) {
  return normalizeOptionalNumber(
    signal.dynamicThresholds?.minimumScore ??
    signal.dynamic_thresholds?.minimumScore ??
    signal.minimumScore ??
    signal.minimum_score ??
    getMinimumValidatedScore(signal)
  );
}

function getScoreUsedForApproval(signal = {}, fallbackScore = 0) {
  return normalizeOptionalNumber(
    signal.scoreUsedForApproval ??
    signal.score_used_for_approval ??
    signal.execution?.scoreUsedForApproval ??
    signal.execution?.adjustedScore ??
    signal.adjustedScore ??
    signal.adjusted_score ??
    fallbackScore
  );
}

function getExecutionAllowedReason(signal = {}) {
  return (
    signal.executionAllowedReason ||
    signal.execution_allowed_reason ||
    signal.execution?.reason ||
    signal.activationReason ||
    signal.blockReason ||
    signal.block_reason ||
    null
  );
}

function getMarketRegime(signal = {}, fallback = "NORMAL") {
  return signal.marketRegime || signal.market_regime || signal.marketContext?.marketRegime || fallback;
}

function getExecutionAllowed(signal = {}) {
  if (signal.executionAllowed === true || signal.execution_allowed === true) return true;
  if (signal.executionAllowed === false || signal.execution_allowed === false) return false;
  if (signal.execution?.allowed === true) return true;
  if (signal.execution?.allowed === false) return false;

  return null;
}

function getPrimaryFilter(signal = {}, fallbackFilter = null) {
  if (fallbackFilter) return fallbackFilter;
  if (Array.isArray(signal.filterBlocks) && signal.filterBlocks[0]?.filterName) {
    return signal.filterBlocks[0].filterName;
  }
  if (Array.isArray(signal.filterPenalties) && signal.filterPenalties[0]?.filterName) {
    return signal.filterPenalties[0].filterName;
  }
  if (signal.executionAllowed === false || signal.execution_allowed === false) return "execution_block";
  if (signal.blocked) return "engine_block";

  return "operational_confirmation";
}

function normalizeFilterLabel(filterName = "unknown") {
  const labels = {
    adaptive_block: "Anti Loss",
    anti_loss_penalty: "Anti Loss",
    dynamic_threshold_block: "Dynamic Threshold",
    dynamic_threshold_penalty: "Dynamic Threshold",
    engine_error: "Engine Error",
    execution_block: "Execution Validation",
    fallback_data: "Market Data",
    low_score_block: "Trend Strength",
    market_quality_penalty: "Trend Strength",
    operational_confirmation: "Operational Confirmation",
    predictive_ai_block: "Predictive AI",
    predictive_ai_penalty: "Predictive AI",
    sniper_block: "Sniper Timing",
    strategy_blocks: "Strategy Filters"
  };

  return labels[filterName] || String(filterName || "unknown").replace(/_/g, " ");
}

function getBlockReason(signal = {}, fallbackReason = null) {
  if (fallbackReason) return fallbackReason;
  if (signal.blockReason || signal.block_reason) return signal.blockReason || signal.block_reason;
  if (Array.isArray(signal.filterBlocks) && signal.filterBlocks[0]?.reason) return signal.filterBlocks[0].reason;
  if (Array.isArray(signal.blocks) && signal.blocks.length) return signal.blocks.join(" | ");
  if (signal.executionAllowed === false || signal.execution_allowed === false) {
    return signal.execution?.reason || "Execução operacional não permitida.";
  }
  if (!getSignalDirection(signal)) return "Direção operacional ausente ou WAIT.";

  const score = getSignalScore(signal);
  const minimum = getMinimumValidatedScore(signal);
  if (score < minimum) return `Score abaixo do mínimo confirmado (${score.toFixed(1)} < ${minimum}).`;

  return "Sinal não confirmado pelos critérios operacionais.";
}

function buildDebugEvent(signal = {}, options = {}) {
  const score = getSignalScore(signal);
  const blockReason = getBlockReason(signal, options.blockReason);
  const filterName = getPrimaryFilter(signal, options.filterName);
  const scoreUsedForApproval = getScoreUsedForApproval(signal, score);
  const minimumScore = getLoggedMinimumScore(signal);

  return {
    symbol: signal.symbol || signal.asset || options.symbol || "UNKNOWN",
    score,
    scoreBeforeAdaptiveAdjustment: normalizeOptionalNumber(
      signal.scoreBeforeAdaptiveAdjustment ?? signal.score_before_adaptive_adjustment
    ),
    scoreAfterAdaptiveAdjustment: normalizeOptionalNumber(
      signal.scoreAfterAdaptiveAdjustment ?? signal.score_after_adaptive_adjustment
    ),
    scoreUsedForApproval,
    minimumScore,
    executionAllowedReason: getExecutionAllowedReason(signal),
    confidence: Number(signal.confidence ?? score ?? 0),
    marketRegime: getMarketRegime(signal, options.marketRegime),
    executionAllowed: getExecutionAllowed(signal),
    blocked: Boolean(options.blocked),
    blockReason: options.blocked ? blockReason : null,
    blockedBy: options.blocked ? filterName : null,
    activationReason: options.blocked ? null : signal.activationReason || signal.execution?.reason || "Entrada aprovada pelos critérios operacionais.",
    filter: options.blocked ? filterName : null,
    filterLabel: options.blocked ? normalizeFilterLabel(filterName) : null,
    signal: signal.signal || signal.direction || "WAIT",
    strategyName: signal.strategyName || signal.strategy_name || signal.strategy || null,
    source: options.source || "engine",
    stage: options.stage || null,
    timestamp: new Date().toISOString()
  };
}

function pushEvent(event) {
  debugState.recentEvents.unshift(event);
  debugState.recentEvents = debugState.recentEvents.slice(0, MAX_EVENTS);
  debugState.updatedAt = event.timestamp;
}

function incrementReason(event) {
  const label = event.filterLabel || normalizeFilterLabel(event.filter);
  debugState.topBlockReasons[label] = (debugState.topBlockReasons[label] || 0) + 1;
}

function recordAnalyzed(signal = {}, options = {}) {
  debugState.analyzed += 1;
  const event = buildDebugEvent(signal, {
    ...options,
    blocked: false
  });

  pushEvent({ ...event, type: "analyzed" });
  emitStructuredLog("signal_analyzed", event);

  return event;
}

function recordApproved(signal = {}, options = {}) {
  debugState.approved += 1;
  const event = buildDebugEvent(signal, {
    ...options,
    blocked: false
  });

  pushEvent({ ...event, type: "approved" });
  emitStructuredLog("signal_approved", event);

  return event;
}

function recordBlocked(signal = {}, options = {}) {
  debugState.blocked += 1;
  const event = buildDebugEvent(signal, {
    ...options,
    blocked: true
  });

  incrementReason(event);
  pushEvent({ ...event, type: "blocked" });
  emitStructuredLog("signal_blocked", event);

  return event;
}

function recordFinalDecision(signal = {}, options = {}) {
  recordAnalyzed(signal, options);

  if (isConfirmedOperationalSignal(signal)) {
    return recordApproved(signal, options);
  }

  return recordBlocked(signal, {
    ...options,
    filterName: options.filterName || getPrimaryFilter(signal),
    blockReason: options.blockReason || getBlockReason(signal)
  });
}

function getDebugSummary() {
  const topBlockReasons = Object.entries(debugState.topBlockReasons)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [reason, count]) => {
      acc[reason] = count;
      return acc;
    }, {});

  return {
    analyzed: debugState.analyzed,
    approved: debugState.approved,
    blocked: debugState.blocked,
    approvalRate: debugState.analyzed
      ? Number(((debugState.approved / debugState.analyzed) * 100).toFixed(2))
      : 0,
    topBlockReasons,
    startedAt: debugState.startedAt,
    updatedAt: debugState.updatedAt,
    recentEvents: debugState.recentEvents
  };
}

function resetDebugSummary() {
  debugState.analyzed = 0;
  debugState.approved = 0;
  debugState.blocked = 0;
  debugState.topBlockReasons = {};
  debugState.recentEvents = [];
  debugState.startedAt = new Date().toISOString();
  debugState.updatedAt = null;
}

module.exports = {
  getDebugSummary,
  recordAnalyzed,
  recordApproved,
  recordBlocked,
  recordFinalDecision,
  resetDebugSummary
};
