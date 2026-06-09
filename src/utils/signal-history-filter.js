const OPERATIONAL_DIRECTIONS = new Set(["CALL", "PUT"]);
const BLOCKED_STATUSES = new Set([
  "blocked",
  "bloqueado",
  "rejected",
  "rejeitado",
  "invalid",
  "invalido",
  "cancelled",
  "canceled",
  "wait",
  "waiting"
]);
const BLOCKED_RESULTS = new Set([
  "blocked",
  "bloqueado",
  "rejected",
  "rejeitado",
  "invalid",
  "invalido",
  "cancelled",
  "canceled",
  "wait",
  "waiting"
]);

function normalizeDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return OPERATIONAL_DIRECTIONS.has(normalized) ? normalized : "";
}

function getSignalDirection(signal = {}) {
  return (
    normalizeDirection(signal.direction) ||
    normalizeDirection(signal.signal) ||
    normalizeDirection(signal.action) ||
    normalizeDirection(signal.side) ||
    normalizeDirection(signal.type) ||
    normalizeDirection(signal.result)
  );
}

function getSignalScore(signal = {}) {
  const score = Number(
    signal.adjusted_score ??
    signal.adjustedScore ??
    signal.final_score ??
    signal.finalScore ??
    signal.score ??
    signal.confidence ??
    0
  );

  return Number.isFinite(score) ? score : 0;
}

function getMinimumValidatedScore(signal = {}) {
  const explicitMinimum = Number(
    signal.minimum_score ??
    signal.minimumScore ??
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

function isBlockedSignal(signal = {}) {
  const status = String(signal.status || signal.signal_status || "").trim().toLowerCase();
  const result = String(signal.result || "").trim().toLowerCase();
  const direction = String(signal.direction || signal.signal || "").trim().toUpperCase();

  return (
    signal.blocked === true ||
    signal.executionAllowed === false ||
    direction === "WAIT" ||
    BLOCKED_STATUSES.has(status) ||
    BLOCKED_RESULTS.has(result)
  );
}

function isConfirmedOperationalSignal(signal = {}) {
  if (!signal || typeof signal !== "object") return false;
  if (isBlockedSignal(signal)) return false;

  const direction = getSignalDirection(signal);
  if (!OPERATIONAL_DIRECTIONS.has(direction)) return false;

  if (signal.executionAllowed !== true && signal.execution_allowed !== true) {
    return false;
  }

  return getSignalScore(signal) >= getMinimumValidatedScore(signal);
}

function filterConfirmedOperationalSignals(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(isConfirmedOperationalSignal);
}

module.exports = {
  isConfirmedOperationalSignal,
  filterConfirmedOperationalSignals,
  getSignalDirection,
  getSignalScore,
  getMinimumValidatedScore
};
