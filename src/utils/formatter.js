function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeDirection(direction) {
  const value = String(direction || "").trim().toUpperCase();

  if (["CALL", "BUY", "UP", "ALTA", "COMPRA"].includes(value)) {
    return "CALL";
  }

  if (["PUT", "SELL", "DOWN", "BAIXA", "VENDA"].includes(value)) {
    return "PUT";
  }

  return "AGUARDANDO";
}

function getPriorityLabel(confidence = 0) {
  const value = clamp(confidence);

  if (value >= 90) return "Máxima";
  if (value >= 80) return "Alta";
  if (value >= 65) return "Moderada";
  return "Observação";
}

function toPercent(value = 0) {
  return `${Math.round(clamp(value))}%`;
}

module.exports = {
  clamp,
  normalizeDirection,
  getPriorityLabel,
  toPercent
};