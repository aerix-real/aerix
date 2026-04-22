function evaluateEntry(direction, m5, modeProfile) {
  const reasons = [];
  const blocks = [];
  let score = 0;

  if (!m5?.valid) {
    return {
      direction: "WAIT",
      score: 0,
      reasons: [],
      blocks: ["M5 inválido para timing."]
    };
  }

  const macdState = m5?.macd?.state || "neutral";
  const rsiZone = m5?.rsi?.zone || "neutral";
  const stochasticState = m5?.stochastic?.state || "neutral";
  const bollingerState = m5?.bollinger?.state || "neutral";
  const atrClass = m5?.atr?.class || "unknown";
  const priceZone = m5?.structure?.zone || "neutral";

  if (direction === "CALL") {
    if (macdState === "bullish") {
      score += 18;
      reasons.push("MACD do M5 favorece compra.");
    }

    if (rsiZone === "bullish") {
      score += 12;
      reasons.push("RSI do M5 em faixa compradora saudável.");
    } else if (rsiZone === "oversold") {
      score += 6;
      reasons.push("RSI sugere reação compradora.");
    }

    if (stochasticState === "bullish") {
      score += 12;
      reasons.push("Stochastic do M5 confirma timing de compra.");
    } else if (stochasticState === "overbought" && modeProfile.blockers.forbidCounterTrend) {
      blocks.push("Stochastic esticado para compra.");
    }

    if (bollingerState === "upper_half") {
      score += 8;
      reasons.push("Preço no M5 trabalha na metade superior da Bollinger.");
    } else if (bollingerState === "below_lower") {
      score += 4;
      reasons.push("Preço abaixo da banda inferior pode favorecer reação.");
    }

    if (priceZone === "near_support") {
      score += 10;
      reasons.push("Preço próximo de suporte favorece CALL.");
    }

    if (priceZone === "near_resistance" && modeProfile.blockers.forbidNearResistanceCall) {
      blocks.push("Preço muito próximo da resistência para CALL.");
    }
  }

  if (direction === "PUT") {
    if (macdState === "bearish") {
      score += 18;
      reasons.push("MACD do M5 favorece venda.");
    }

    if (rsiZone === "bearish") {
      score += 12;
      reasons.push("RSI do M5 em faixa vendedora saudável.");
    } else if (rsiZone === "overbought") {
      score += 6;
      reasons.push("RSI sugere reação vendedora.");
    }

    if (stochasticState === "bearish") {
      score += 12;
      reasons.push("Stochastic do M5 confirma timing de venda.");
    } else if (stochasticState === "oversold" && modeProfile.blockers.forbidCounterTrend) {
      blocks.push("Stochastic esticado para venda.");
    }

    if (bollingerState === "lower_half") {
      score += 8;
      reasons.push("Preço no M5 trabalha na metade inferior da Bollinger.");
    } else if (bollingerState === "above_upper") {
      score += 4;
      reasons.push("Preço acima da banda superior pode favorecer reação.");
    }

    if (priceZone === "near_resistance") {
      score += 10;
      reasons.push("Preço próximo de resistência favorece PUT.");
    }

    if (priceZone === "near_support" && modeProfile.blockers.forbidNearSupportPut) {
      blocks.push("Preço muito próximo do suporte para PUT.");
    }
  }

  if (atrClass === "medium") {
    score += 10;
    reasons.push("Volatilidade equilibrada para execução.");
  } else if (atrClass === "high") {
    score += 8;
    reasons.push("Volatilidade elevada com potencial de deslocamento.");
  } else if (atrClass === "low" && modeProfile.blockers.forbidLowVolatility) {
    blocks.push("Volatilidade baixa para entrada segura.");
  }

  return {
    direction,
    score,
    reasons,
    blocks
  };
}

module.exports = {
  evaluateEntry
};