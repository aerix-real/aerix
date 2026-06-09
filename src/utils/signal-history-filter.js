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
    signal.final_score ??
    signal.finalScore ??
    signal.score ??
    signal.confidence ??
    0
  );

  return Number.isFinite(score) ? score : 0;
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

  return getSignalScore(signal) > 0;
}

function filterConfirmedOperationalSignals(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(isConfirmedOperationalSignal);
}

module.exports = {
  isConfirmedOperationalSignal,
  filterConfirmedOperationalSignals,
  getSignalDirection,
  getSignalScore
};
