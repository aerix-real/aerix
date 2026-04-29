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
    risks.push("Mercado com volatilidade muito baixa antes do sinal.");
  }

  if (h1Strength < 0.08 && m15Strength < 0.08) {
    risks.push("Sem força direcional suficiente em H1/M15.");
  }

  if (m5Vol > 1.2) {
    risks.push("Volatilidade excessiva antes do sinal.");
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

    const marketRisks = detectMarketRisk(snapshot);
    risks.push(...marketRisks);

    if (probableDirection === "WAIT") {
      preScore -= 18;
      risks.push("Direção provável indefinida antes da estratégia.");
    } else {
      preScore += 8;
      reasons.push(`Direção provável detectada: ${probableDirection}.`);
    }

    if (symbolStats?.total >= 5) {
      if (symbolStats.winrate >= 68) {
        preScore += 12;
        reasons.push("Ativo possui histórico favorável.");
      }

      if (symbolStats.lossrate >= 60) {
        preScore -= 14;
        risks.push("Ativo possui histórico recente desfavorável.");
      }
    }

    if (hourStats?.total >= 5) {
      if (hourStats.winrate >= 65) {
        preScore += 8;
        reasons.push("Horário operacional historicamente favorável.");
      }

      if (hourStats.lossrate >= 65) {
        preScore -= 16;
        risks.push("Horário operacional com alto índice de loss.");
      }
    }

    if (directionStats?.total >= 5) {
      if (directionStats.winrate >= 65) {
        preScore += 6;
        reasons.push("Direção provável tem bom desempenho histórico.");
      }

      if (directionStats.lossrate >= 65) {
        preScore -= 10;
        risks.push("Direção provável tem histórico fraco.");
      }
    }

    if (symbolDirectionStats?.total >= 5) {
      if (symbolDirectionStats.winrate >= 68) {
        preScore += 10;
        reasons.push("Ativo + direção apresentam confluência histórica positiva.");
      }

      if (symbolDirectionStats.lossrate >= 65) {
        preScore -= 18;
        risks.push("Ativo + direção apresentam padrão ruim de loss.");
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
      preScore -= 28;
      risks.push("Memória de IA detectou padrão crítico antes do sinal.");
    }

    if (mode === "conservative") {
      preScore -= 4;
    }

    if (mode === "aggressive") {
      preScore += 4;
    }

    preScore = clamp(preScore);

    const minimum =
      mode === "conservative"
        ? 58
        : mode === "aggressive"
          ? 42
          : 50;

    const blocked = preScore < minimum || risks.length >= 3;

    return {
      blocked,
      preScore,
      minimum,
      symbol,
      hour,
      probableDirection,
      reasons,
      risks,
      decision: blocked ? "PRE_BLOCKED" : "PRE_APPROVED",
      explanation: blocked
        ? `IA preditiva bloqueou antes do sinal. Pre-score ${preScore}%. ${risks.join(" ")}`
        : `IA preditiva aprovou análise inicial. Pre-score ${preScore}%. ${reasons.join(" ")}`
    };
  }
}

module.exports = new PredictiveAiService();