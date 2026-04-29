function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function buildHumanDirectionLabel(signal) {
  if (signal === "CALL") return "compra";
  if (signal === "PUT") return "venda";
  return "indefinido";
}

function buildRiskLabel(score) {
  if (score >= 90) return "baixo";
  if (score >= 82) return "controlado";
  if (score >= 74) return "moderado";
  return "alto";
}

function detectInstitutionalRisk(signal = {}) {
  const risks = [];

  if (signal.market_regime?.includes("LATERAL")) {
    risks.push("mercado lateral");
  }

  if (Number(signal.volatility || 0) < 0.12) {
    risks.push("baixa volatilidade");
  }

  if (signal.signal === "WAIT") {
    risks.push("sem direção operacional");
  }

  if (Array.isArray(signal.blocks) && signal.blocks.length) {
    risks.push(...signal.blocks.slice(0, 3));
  }

  if (Number(signal.finalScore || signal.confidence || 0) < 70) {
    risks.push("score abaixo do padrão institucional");
  }

  return risks;
}

function classifyInstitutionalDecision(signal = {}) {
  const score = Number(signal.finalScore || signal.confidence || 0);
  const risks = detectInstitutionalRisk(signal);

  if (signal.signal === "WAIT") {
    return {
      approved: false,
      tier: "AGUARDAR",
      reason: "Sem direção operacional suficiente.",
      risks
    };
  }

  if (risks.length >= 3) {
    return {
      approved: false,
      tier: "BLOQUEADO",
      reason: "Risco institucional elevado.",
      risks
    };
  }

  if (score >= 90) {
    return {
      approved: true,
      tier: "INSTITUCIONAL",
      reason: "Alta confluência técnica, score elevado e risco controlado.",
      risks
    };
  }

  if (score >= 82) {
    return {
      approved: true,
      tier: "FORTE",
      reason: "Boa confluência operacional com risco aceitável.",
      risks
    };
  }

  if (score >= 74) {
    return {
      approved: true,
      tier: "MODERADO",
      reason: "Oportunidade válida, porém exige cautela.",
      risks
    };
  }

  return {
    approved: false,
    tier: "BLOQUEADO",
    reason: "Score insuficiente para padrão institucional.",
    risks
  };
}

function applyLossPenalty(signal = {}, history = []) {
  const recentLosses = Array.isArray(history)
    ? history.slice(0, 10).filter((item) => {
        const result = String(item.result || "").toLowerCase();
        return ["loss", "red", "lost"].includes(result);
      }).length
    : 0;

  if (recentLosses >= 3) {
    const currentScore = Number(signal.finalScore || signal.confidence || signal.score || 0);
    const adjustedScore = clamp(currentScore - 8);

    return {
      ...signal,
      finalScore: adjustedScore,
      final_score: adjustedScore,
      adjustedScore,
      adjusted_score: adjustedScore,
      blocked: adjustedScore < 72,
      blockReason:
        adjustedScore < 72
          ? "Sequência recente de losses detectada pela IA"
          : signal.blockReason || signal.block_reason || null,
      block_reason:
        adjustedScore < 72
          ? "Sequência recente de losses detectada pela IA"
          : signal.blockReason || signal.block_reason || null,
      adaptiveReasons: [
        ...(signal.adaptiveReasons || []),
        "IA aplicou penalidade por sequência recente de losses"
      ]
    };
  }

  return signal;
}

function explainSignal({ symbol, signal, confidence, reasons, modeConfig }) {
  const directionLabel = buildHumanDirectionLabel(signal);
  const score = Number(confidence || 0);
  const riskLabel = buildRiskLabel(score);

  const intro =
    signal === "WAIT"
      ? `O ativo ${symbol} ainda não apresenta confluência suficiente para entrada segura no momento.`
      : `O ativo ${symbol} apresenta oportunidade de ${directionLabel} com confiança ${score}%.`;

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
      : `O risco operacional atual é ${riskLabel}, considerando score, tendência, volatilidade e confluência.`;

  return [intro, modeText, reasonsText, riskText].filter(Boolean).join(" ");
}

function explainInstitutionalDecision(signal = {}) {
  const decision = classifyInstitutionalDecision(signal);
  const direction = buildHumanDirectionLabel(signal.signal);
  const score = Number(signal.finalScore || signal.confidence || 0);

  const riskText = decision.risks.length
    ? `Riscos detectados: ${decision.risks.join("; ")}.`
    : "Nenhum bloqueio crítico detectado.";

  return {
    ...decision,
    explanation:
      decision.approved
        ? `IA institucional aprovou ${direction} em ${signal.symbol} com score ${score}%. ${decision.reason} ${riskText}`
        : `IA institucional bloqueou ${signal.symbol || "ativo"}: ${decision.reason} ${riskText}`
  };
}

module.exports = {
  explainSignal,
  classifyInstitutionalDecision,
  explainInstitutionalDecision,
  applyLossPenalty
};