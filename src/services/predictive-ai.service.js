const signalRepository = require("../repositories/signal.repository");
const aiMemoryRepository = require("../repositories/aiMemory.repository");

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function getProbableDirection(snapshot = {}) {
  const h1 = snapshot?.timeframes?.h1 || {};
  const m15 = snapshot?.timeframes?.m15 || {};
  const m5 = snapshot?.timeframes?.m5 || {};

  const votes = [
    h1.direction,
    m15.direction,
    m5.direction
  ];

  const upVotes = votes.filter((v) => v === "up").length;
  const downVotes = votes.filter((v) => v === "down").length;

  if (upVotes > downVotes) return "CALL";
  if (downVotes > upVotes) return "PUT";

  return "WAIT";
}

function detectMarketRisk(snapshot = {}) {
  const risks = [];

  const m5Vol = Number(snapshot?.timeframes?.m5?.volatilityPercent || 0);
  const h1Strength = Number(snapshot?.timeframes?.h1?.strengthPercent || 0);
  const m15Strength = Number(snapshot?.timeframes?.m15?.strengthPercent || 0);

  if (m5Vol < 0.08) {
    risks.push({
      severity: m5Vol < 0.025 ? "critical" : m5Vol < 0.04 ? "severe" : "moderate",
      reason: "Mercado com volatilidade muito baixa antes do sinal."
    });
  }

  if (h1Strength < 0.08 && m15Strength < 0.08) {
    risks.push({
      severity: h1Strength < 0.025 && m15Strength < 0.025 ? "critical" : h1Strength < 0.04 && m15Strength < 0.04 ? "severe" : "moderate",
      reason: "Sem força direcional suficiente em H1/M15."
    });
  }

  if (m5Vol > 1.2) {
    risks.push({
      severity: m5Vol > 2.2 ? "critical" : m5Vol > 1.8 ? "severe" : "moderate",
      reason: "Volatilidade excessiva antes do sinal."
    });
  }

  return risks;
}

class PredictiveAiService {
  async evaluatePreSignal({ symbol, snapshot, mode }) {
    const stats = await signalRepository.getStats();
    const badPatterns = await aiMemoryRepository.getBadPatterns(50).catch(() => []);

    const hour = new Date().getHours();
    const probableDirection = getProbableDirection(snapshot);

    const symbolStats = stats.bySymbol?.[symbol] || null;
    const hourStats = stats.byHour?.[hour] || null;
    const directionStats = stats.bySignal?.[probableDirection] || null;
    const symbolDirectionStats = stats.bySymbolSignal?.[`${symbol}:${probableDirection}`] || null;

    let preScore = 50;
    const reasons = [];
    const risks = [];
    const predictiveAudit = {
      volatilityContribution: 0,
      historicalContribution: 0,
      directionContribution: 0,
      regimeContribution: 0
    };

    const applyPredictiveContribution = (bucket, delta) => {
      preScore += delta;
      predictiveAudit[bucket] += delta;
    };

    const marketRisks = detectMarketRisk(snapshot);
    risks.push(...marketRisks);

    if (probableDirection === "WAIT") {
      applyPredictiveContribution("directionContribution", -18);
      risks.push({ severity: mode === "conservative" ? "severe" : "moderate", reason: "Direção provável indefinida antes da estratégia." });
    } else {
      applyPredictiveContribution("directionContribution", 8);
      reasons.push(`Direção provável detectada: ${probableDirection}.`);
    }

    if (symbolStats?.total >= 5) {
      if (symbolStats.winrate >= 68) {
        applyPredictiveContribution("historicalContribution", 12);
        reasons.push("Ativo possui histórico favorável.");
      }

      if (symbolStats.lossrate >= 60) {
        applyPredictiveContribution("historicalContribution", -14);
        risks.push({ severity: symbolStats.lossrate >= 88 ? "critical" : symbolStats.lossrate >= 78 ? "severe" : "moderate", reason: "Ativo possui histórico recente desfavorável." });
      }
    }

    if (hourStats?.total >= 5) {
      if (hourStats.winrate >= 65) {
        applyPredictiveContribution("historicalContribution", 8);
        reasons.push("Horário operacional historicamente favorável.");
      }

      if (hourStats.lossrate >= 65) {
        applyPredictiveContribution("historicalContribution", -16);
        risks.push({ severity: hourStats.lossrate >= 90 ? "critical" : hourStats.lossrate >= 82 ? "severe" : "moderate", reason: "Horário operacional com alto índice de loss." });
      }
    }

    if (directionStats?.total >= 5) {
      if (directionStats.winrate >= 65) {
        applyPredictiveContribution("directionContribution", 6);
        reasons.push("Direção provável tem bom desempenho histórico.");
      }

      if (directionStats.lossrate >= 65) {
        applyPredictiveContribution("directionContribution", -10);
        risks.push({ severity: directionStats.lossrate >= 90 ? "critical" : directionStats.lossrate >= 82 ? "severe" : "moderate", reason: "Direção provável tem histórico fraco." });
      }
    }

    if (symbolDirectionStats?.total >= 5) {
      if (symbolDirectionStats.winrate >= 68) {
        applyPredictiveContribution("historicalContribution", 10);
        reasons.push("Ativo + direção apresentam confluência histórica positiva.");
      }

      if (symbolDirectionStats.lossrate >= 65) {
        applyPredictiveContribution("historicalContribution", -18);
        risks.push({ severity: symbolDirectionStats.lossrate >= 88 ? "critical" : symbolDirectionStats.lossrate >= 80 ? "severe" : "moderate", reason: "Ativo + direção apresentam padrão ruim de loss." });
      }
    }

    const criticalPattern = badPatterns.find((pattern) => {
      const sameSymbol = String(pattern.symbol || "") === String(symbol || "");
      const sameDirection = String(pattern.direction || "") === String(probableDirection || "");
      const sameHour = Number(pattern.hour) === Number(hour);
      const total = Number(pattern.total || 0);
      const losses = Number(pattern.losses || 0);
      const lossrate = total ? (losses / total) * 100 : 0;

      return sameSymbol && sameDirection && sameHour && total >= 4 && lossrate >= 70;
    });

    if (criticalPattern) {
      const total = Number(criticalPattern.total || 0);
      const losses = Number(criticalPattern.losses || 0);
      const lossrate = total ? (losses / total) * 100 : 0;

      applyPredictiveContribution("historicalContribution", lossrate >= 85 ? -32 : -24);
      risks.push({
        severity: total >= 6 && lossrate >= 85 ? "critical" : "severe",
        reason: "Memória de IA detectou padrão crítico antes do sinal."
      });
    }

    if (mode === "conservative") {
      applyPredictiveContribution("regimeContribution", -4);
    }

    if (mode === "aggressive") {
      applyPredictiveContribution("regimeContribution", 4);
    }

    preScore = clamp(preScore);

    const minimum =
      mode === "conservative"
        ? 58
        : mode === "aggressive"
          ? 38
          : 46;

    const criticalRisks = risks.filter((risk) => risk.severity === "critical");
    const severeRisks = risks.filter((risk) => risk.severity === "severe" || risk.severity === "critical");
    const moderateRisks = risks.filter((risk) => risk.severity === "moderate");
    const scoreAdjustment = clamp(
      Math.round((50 - preScore) * -0.45) - moderateRisks.length * 2 - severeRisks.length,
      -22,
      8
    );
    const criticallyLowScore = mode === "aggressive"
      ? preScore < 24
      : mode === "balanced"
        ? preScore < 30
        : preScore < minimum;
    const blocked = mode === "conservative"
      ? criticallyLowScore || severeRisks.length >= 1
      : mode === "aggressive"
        ? criticallyLowScore || criticalRisks.length >= 2
        : criticallyLowScore || criticalRisks.length >= 1;
    const riskReasons = risks.map((risk) => risk.reason);
    const predictiveBlockScore = preScore;
    const finalPredictiveScore = preScore;
    const predictiveThreshold = minimum;
    const auditMetrics = {
      predictiveBlockScore,
      volatilityContribution: predictiveAudit.volatilityContribution,
      historicalContribution: predictiveAudit.historicalContribution,
      directionContribution: predictiveAudit.directionContribution,
      regimeContribution: predictiveAudit.regimeContribution,
      finalPredictiveScore,
      predictiveThreshold
    };

    console.log(JSON.stringify({
      scope: "aerix_predictive_ai_gate",
      event: "predictive_ai_gate_audit",
      timestamp: new Date().toISOString(),
      symbol,
      mode,
      hour,
      probableDirection,
      blocked,
      ...auditMetrics
    }));

    return {
      blocked,
      preScore,
      minimum,
      predictiveBlockScore,
      volatilityContribution: auditMetrics.volatilityContribution,
      historicalContribution: auditMetrics.historicalContribution,
      directionContribution: auditMetrics.directionContribution,
      regimeContribution: auditMetrics.regimeContribution,
      finalPredictiveScore,
      predictiveThreshold,
      scoreAdjustment,
      symbol,
      hour,
      probableDirection,
      reasons,
      risks: riskReasons,
      riskDetails: risks,
      criticalRisks: criticalRisks.map((risk) => risk.reason),
      severeRisks: severeRisks.map((risk) => risk.reason),
      moderateRisks: moderateRisks.map((risk) => risk.reason),
      decision: blocked ? "PRE_BLOCKED" : "PRE_APPROVED_WITH_SCORE_ADJUSTMENT",
      explanation: blocked
        ? `IA preditiva bloqueou risco crítico antes do sinal. Pre-score ${preScore}%. ${riskReasons.join(" ")}`
        : `IA preditiva converteu riscos moderados em ajuste de score (${scoreAdjustment}). Pre-score ${preScore}%. ${reasons.join(" ")}`
    };
  }
}

module.exports = new PredictiveAiService();