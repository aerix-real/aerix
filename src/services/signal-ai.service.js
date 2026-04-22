function buildHumanDirectionLabel(signal) {
  if (signal === "CALL") return "compra";
  if (signal === "PUT") return "venda";
  return "indefinido";
}

function buildRiskLabel(confidence) {
  if (confidence >= 90) return "muito alta";
  if (confidence >= 82) return "alta";
  if (confidence >= 74) return "moderada";
  return "elevada";
}

function explainSignal({ symbol, signal, confidence, reasons, modeConfig }) {
  const directionLabel = buildHumanDirectionLabel(signal);
  const riskLabel = buildRiskLabel(confidence);

  const intro =
    signal === "WAIT"
      ? `O ativo ${symbol} ainda não apresenta confluência suficiente para entrada segura no momento.`
      : `O ativo ${symbol} apresenta oportunidade de ${directionLabel} com confiança ${confidence}%.`;

  const modeText = modeConfig
    ? `O modo operacional ativo é ${modeConfig.label}, com exigência mínima de ${modeConfig.minimumConfidence}% de confiança.`
    : "";

  const reasonsText =
    reasons && reasons.length
      ? `Os principais fatores observados foram: ${reasons.join("; ")}.`
      : "Ainda não foi possível consolidar justificativas suficientes.";

  const riskText =
    signal === "WAIT"
      ? "A recomendação é aguardar uma estrutura mais limpa antes de operar."
      : `O nível de convicção atual é ${riskLabel}, mas toda entrada ainda exige gestão de risco e disciplina operacional.`;

  return [intro, modeText, reasonsText, riskText].filter(Boolean).join(" ");
}

module.exports = {
  explainSignal
};