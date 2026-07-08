const BLOCKER_COUNTERS = [
  "trendAligned",
  "m5M15AlignmentRequired",
  "breakoutStrengthAboveThreshold",
  "reversalPatternFound",
  "macdDirectionConfirmed",
  "priceImpulseConfirmed",
  "retracementDetected",
  "adxMomentumConfirmed",
  "lowVolatility",
  "veryLowVolatility",
  "predictiveGate",
  "dynamicThreshold",
  "executionValidation",
  "liquiditySweepFalseBreakoutNotConfirmed",
  "liquidityLevelDetected",
  "sweepDetected",
  "closeBackInsideRange",
  "rejectionWickConfirmed",
  "continuationFailureConfirmed",
  "tradableLocalVolatility"
];

const COUNTER_ALIASES = {
  predictive_ai_block: "predictiveGate",
  predictive_ai_penalty: "predictiveGate",
  dynamic_threshold_block: "dynamicThreshold",
  dynamic_threshold_penalty: "dynamicThreshold",
  low_score_block: "dynamicThreshold",
  execution_block: "executionValidation",
  liquiditySweepCallNotConfirmed: "liquiditySweepFalseBreakoutNotConfirmed",
  liquiditySweepPutNotConfirmed: "liquiditySweepFalseBreakoutNotConfirmed",
  strategyScoreBelowThreshold: "dynamicThreshold",
  breakoutStrength: "breakoutStrengthAboveThreshold",
  reversalPattern: "reversalPatternFound",
  MACD: "macdDirectionConfirmed",
  macd: "macdDirectionConfirmed",
  RSI: "reversalPatternFound"
};

const state = {
  cycleCount: 0,
  nearActivationCount: 0,
  closestBlocker: null,
  counters: Object.fromEntries(BLOCKER_COUNTERS.map((name) => [name, 0])),
  others: 0,
  totalBlocks: 0
};

function normalizeBlocker(blocker) {
  if (!blocker) return "unknown";
  const value = String(blocker).trim();
  return COUNTER_ALIASES[value] || value;
}

function isKnownCounter(blocker) {
  return BLOCKER_COUNTERS.includes(blocker);
}

function getCandidateAudit(candidate = {}) {
  const audit = candidate.eligibilityAudit || candidate.audit || {};
  return {
    criteriaPassed: Number(audit.criteriaPassed || 0),
    criteriaFailed: Number(audit.criteriaFailed || 0),
    partialScore: Number(audit.score ?? candidate.rawScore ?? candidate.score ?? candidate.partialScore ?? 0),
    blockedBy: audit.blockedBy || candidate.explanation || candidate.blocker || null,
    minPartialScore: Number(audit.context?.minPartialScore ?? candidate.minPartialScore ?? 0)
  };
}

function buildCandidatePayload({ candidate = {}, context = {}, finalSignal = {} } = {}) {
  const audit = getCandidateAudit(candidate);
  const blocked = !(candidate.valid && candidate.direction);
  const blocker = normalizeBlocker(blocked ? audit.blockedBy : null);

  return {
    symbol: context.symbol || finalSignal.symbol || finalSignal.asset || null,
    mode: context.mode || finalSignal.mode || "balanced",
    strategy: candidate.name || candidate.strategyName || candidate.strategy || null,
    directionCandidate: candidate.direction || null,
    partialScore: audit.partialScore,
    weightedScore: Number(candidate.weightedScore || 0),
    valid: Boolean(candidate.valid && candidate.direction),
    blocked,
    blocker: blocked ? blocker : null,
    criteriaPassed: audit.criteriaPassed,
    criteriaFailed: audit.criteriaFailed,
    marketRegime: context.marketRegime || finalSignal.marketRegime || finalSignal.market_regime || null,
    alignment: Number(context.alignment ?? finalSignal.mtf?.alignment ?? 0),
    volatility: Number(context.volatility ?? finalSignal.volatility ?? 0),
    predictiveScore: Number(finalSignal.predictiveAi?.predictiveScore ?? finalSignal.preSignalScore ?? 0),
    predictiveThreshold: Number(finalSignal.predictiveAi?.predictiveThreshold ?? finalSignal.preSignalMinimum ?? 0),
    minPartialScore: audit.minPartialScore
  };
}

function incrementBlocker(blocker) {
  const normalized = normalizeBlocker(blocker);
  if (!normalized || normalized === "unknown") return;
  if (isKnownCounter(normalized)) state.counters[normalized] += 1;
  else state.others += 1;
  state.totalBlocks += 1;
}

function updateNearActivation(payload) {
  if (!payload.blocked || payload.criteriaFailed !== 1 || payload.partialScore < payload.minPartialScore) return;
  state.nearActivationCount += 1;
  state.closestBlocker = payload.blocker;
}

function formatPercent(count) {
  if (!state.totalBlocks) return "0%";
  return `${Math.round((Number(count || 0) / state.totalBlocks) * 100)}%`;
}

function emitReport() {
  const rows = Object.entries(state.counters)
    .map(([name, count]) => ({ name, count }))
    .concat([{ name: "Outros", count: state.others }])
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);

  console.log(JSON.stringify({
    scope: "aerix_blocker_statistics",
    event: "TOP BLOCKERS",
    timestamp: new Date().toISOString(),
    cycles: state.cycleCount,
    blockerStatistics: Object.fromEntries(rows.map((item) => [item.name, {
      count: item.count,
      percent: formatPercent(item.count)
    }])),
    nearActivation: {
      nearActivationCount: state.nearActivationCount,
      closestBlocker: state.closestBlocker
    }
  }));
}

function recordFinalGates(finalSignal = {}) {
  (finalSignal.filterBlocks || []).forEach((block) => incrementBlocker(block.filterName || block.reason));
  if (finalSignal.predictiveAi?.blocked || finalSignal.preCheck?.blocked) incrementBlocker("predictiveGate");
  if (finalSignal.dynamicThresholdPenalty) incrementBlocker("dynamicThreshold");
  if (finalSignal.executionAllowed === false || finalSignal.execution?.allowed === false) incrementBlocker("executionValidation");

  return {
    cycleCount: state.cycleCount,
    blockerStatistics: { ...state.counters, Outros: state.others },
    nearActivationCount: state.nearActivationCount,
    closestBlocker: state.closestBlocker
  };
}

function recordCycle({ candidates = [], context = {}, finalSignal = {} } = {}) {
  state.cycleCount += 1;
  const payloads = candidates.map((candidate) => buildCandidatePayload({ candidate, context, finalSignal }));

  payloads.forEach((payload) => {
    if (payload.blocked) incrementBlocker(payload.blocker);
    updateNearActivation(payload);
    console.log(JSON.stringify({
      scope: "aerix_blocker_statistics",
      event: "blockerCycle",
      timestamp: new Date().toISOString(),
      ...payload
    }));
  });

  if (state.cycleCount % 100 === 0) emitReport();

  return {
    cycleCount: state.cycleCount,
    blockerStatistics: { ...state.counters, Outros: state.others },
    nearActivationCount: state.nearActivationCount,
    closestBlocker: state.closestBlocker
  };
}

module.exports = {
  BLOCKER_COUNTERS,
  recordCycle,
  recordFinalGates
};
