const OPERATIONAL_DIRECTIONS = new Set(["CALL", "PUT"]);

const CLASSIFICATIONS = Object.freeze({
  HIGH_CONFIDENCE: "HIGH_CONFIDENCE",
  MEDIUM_CONFIDENCE: "MEDIUM_CONFIDENCE",
  WATCHLIST: "WATCHLIST",
  BLOCKED: "BLOCKED"
});

function normalizeDirection(value) {
  return String(value || "").trim().toUpperCase();
}

function getSignalScore(signal = {}) {
  const score = Number(
    signal.adjustedScore ??
    signal.adjusted_score ??
    signal.finalScore ??
    signal.final_score ??
    signal.score ??
    signal.confidence ??
    0
  );

  return Number.isFinite(score) ? score : 0;
}

function getMinimumScore(signal = {}) {
  const explicitMinimum = Number(
    signal.minimumScore ??
    signal.minimum_score ??
    signal.dynamicThresholds?.minimumScore ??
    signal.dynamic_thresholds?.minimumScore
  );

  if (Number.isFinite(explicitMinimum) && explicitMinimum > 0) {
    return explicitMinimum;
  }

  const mode = String(signal.mode || signal.tradingMode || signal.operationMode || "balanced").toLowerCase();

  if (["conservador", "conservative"].includes(mode)) return 88;
  if (["agressivo", "aggressive"].includes(mode)) return 64;

  return 72;
}

function getHighConfidenceScore(signal = {}) {
  const explicitHigh = Number(
    signal.highConfidenceScore ??
    signal.high_confidence_score ??
    signal.dynamicThresholds?.sniperTiming ??
    signal.dynamic_thresholds?.sniperTiming
  );

  if (Number.isFinite(explicitHigh) && explicitHigh > 0) {
    return explicitHigh;
  }

  return Math.min(95, getMinimumScore(signal) + 12);
}

function hasOperationalDirection(signal = {}) {
  return OPERATIONAL_DIRECTIONS.has(normalizeDirection(signal.signal || signal.direction));
}

function isCriticalBlocked(signal = {}) {
  return Boolean(signal.blocked) || signal.classification === CLASSIFICATIONS.BLOCKED;
}

function classifySignal(signal = {}) {
  if (isCriticalBlocked(signal)) {
    return CLASSIFICATIONS.BLOCKED;
  }

  const score = getSignalScore(signal);
  const direction = normalizeDirection(signal.signal || signal.direction);
  const executionAllowed = signal.executionAllowed === true || signal.execution_allowed === true;

  if (OPERATIONAL_DIRECTIONS.has(direction) && executionAllowed) {
    return score >= getHighConfidenceScore(signal)
      ? CLASSIFICATIONS.HIGH_CONFIDENCE
      : CLASSIFICATIONS.MEDIUM_CONFIDENCE;
  }

  return CLASSIFICATIONS.WATCHLIST;
}

function applySignalClassification(signal = {}) {
  const classification = classifySignal(signal);

  signal.classification = classification;
  signal.signalClassification = classification;
  signal.signal_classification = classification;

  return signal;
}

module.exports = {
  CLASSIFICATIONS,
  OPERATIONAL_DIRECTIONS,
  applySignalClassification,
  classifySignal,
  getHighConfidenceScore,
  getMinimumScore,
  getSignalScore,
  hasOperationalDirection
};
