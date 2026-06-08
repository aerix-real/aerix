function normalizeResult(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDirection(value) {
  return String(value || "").trim().toUpperCase();
}

function getScore(signal = {}) {
  const value = signal.final_score ?? signal.finalScore ?? signal.score ?? signal.confidence;
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

function isConfirmedOperationalSignal(signal = {}) {
  const direction = normalizeDirection(signal.signal || signal.direction);
  const result = normalizeResult(signal.result);
  const blocked = Boolean(signal.blocked);
  const confidence = Number(signal.confidence ?? 0);
  const score = getScore(signal);

  if (!["CALL", "PUT"].includes(direction)) return false;
  if (blocked) return false;
  if (result === "CANCELED" || result === "CANCELLED" || result === "EXPIRED") return false;
  if (confidence <= 0 || score <= 0) return false;

  return true;
}

function filterOperationalHistory(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(isConfirmedOperationalSignal);
}

module.exports = {
  isConfirmedOperationalSignal,
  filterOperationalHistory
};
