function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function isBullishTrend(indicators) {
  return indicators?.trend?.bias === "bullish";
}

function isBearishTrend(indicators) {
  return indicators?.trend?.bias === "bearish";
}

function isTrendStrong(indicators) {
  const state = indicators?.adx?.state;
  return state === "strong_bullish_trend" || state === "strong_bearish_trend";
}

function isTrendDeveloping(indicators) {
  const state = indicators?.adx?.state;
  return (
    state === "bullish_trend" ||
    state === "bearish_trend" ||
    state === "developing_trend"
  );
}

function getModeProfile(mode = "balanced") {
  const profiles = {
    conservative: {
      minConfidence: 82,
      weights: {
        trend: 30,
        adx: 20,
        momentum: 18,
        rsi: 10,
        stochastic: 6,
        bollinger: 5,
        structure: 7,
        volatility: 4
      },
      blockers: {
        allowWeakTrend: false,
        allowCounterTrendTiming: false,
        allowNearResistanceCall: false,
        allowNearSupportPut: false,
        allowLowAtr: false
      }
    },
    balanced: {
      minConfidence: 72,
      weights: {
        trend: 26,
        adx: 16,
        momentum: 18,
        rsi: 12,
        stochastic: 8,
        bollinger: 7,
        structure: 7,
        volatility: 6
      },
      blockers: {
        allowWeakTrend: false,
        allowCounterTrendTiming: true,
        allowNearResistanceCall: false,
        allowNearSupportPut: false,
        allowLowAtr: false
      }
    },
    aggressive: {
      minConfidence: 64,
      weights: {
        trend: 22,
        adx: 10,
        momentum: 22,
        rsi: 14,
        stochastic: 12,
        bollinger: 8,
        structure: 5,
        volatility: 7
      },
      blockers: {
        allowWeakTrend: true,
        allowCounterTrendTiming: true,
        allowNearResistanceCall: true,
        allowNearSupportPut: true,
        allowLowAtr: true
      }
    }
  };

  return profiles[mode] || profiles.balanced;
}

function scoreTrend(indicators, direction, weight) {
  const bullish = isBullishTrend(indicators);
  const bearish = isBearishTrend(indicators);

  if (direction === "CALL" && bullish) return weight;
  if (direction === "PUT" && bearish) return weight;
  if (direction === "WAIT") return 0;

  return 0;
}

function scoreADX(indicators, direction, weight) {
  const adxState = indicators?.adx?.state;

  if (!adxState) return 0;

  if (direction === "CALL") {
    if (adxState === "strong_bullish_trend") return weight;
    if (adxState === "bullish_trend") return round(weight * 0.78);
    if (adxState === "developing_trend") return round(weight * 0.45);
  }

  if (direction === "PUT") {
    if (adxState === "strong_bearish_trend") return weight;
    if (adxState === "bearish_trend") return round(weight * 0.78);
    if (adxState === "developing_trend") return round(weight * 0.45);
  }

  return 0;
}

function scoreMACD(indicators, direction, weight) {
  const macdState = indicators?.macd?.state;

  if (direction === "CALL" && macdState === "bullish") return weight;
  if (direction === "PUT" && macdState === "bearish") return weight;

  return 0;
}

function scoreRSI(indicators, direction, weight, mode) {
  const zone = indicators?.rsi?.zone;
  const value = Number(indicators?.rsi?.value);

  if (!Number.isFinite(value)) return 0;

  if (direction === "CALL") {
    if (zone === "bullish") return weight;
    if (zone === "oversold") {
      return mode === "aggressive" ? round(weight * 0.8) : round(weight * 0.4);
    }
  }

  if (direction === "PUT") {
    if (zone === "bearish") return weight;
    if (zone === "overbought") {
      return mode === "aggressive" ? round(weight * 0.8) : round(weight * 0.4);
    }
  }

  return 0;
}

function scoreStochastic(indicators, direction, weight, mode) {
  const state = indicators?.stochastic?.state;

  if (direction === "CALL") {
    if (state === "bullish") return weight;
    if (state === "oversold") {
      return mode === "aggressive" ? round(weight * 0.9) : round(weight * 0.45);
    }
  }

  if (direction === "PUT") {
    if (state === "bearish") return weight;
    if (state === "overbought") {
      return mode === "aggressive" ? round(weight * 0.9) : round(weight * 0.45);
    }
  }

  return 0;
}

function scoreBollinger(indicators, direction, weight, mode) {
  const state = indicators?.bollinger?.state;

  if (direction === "CALL") {
    if (state === "upper_half") return weight;
    if (state === "below_lower") {
      return mode === "aggressive" ? round(weight * 0.75) : round(weight * 0.3);
    }
  }

  if (direction === "PUT") {
    if (state === "lower_half") return weight;
    if (state === "above_upper") {
      return mode === "aggressive" ? round(weight * 0.75) : round(weight * 0.3);
    }
  }

  return 0;
}

function scoreStructure(indicators, direction, weight, mode) {
  const zone = indicators?.structure?.zone;

  if (direction === "CALL") {
    if (zone === "near_support") return weight;
    if (zone === "near_resistance") {
      return mode === "aggressive" ? round(weight * 0.2) : 0;
    }
  }

  if (direction === "PUT") {
    if (zone === "near_resistance") return weight;
    if (zone === "near_support") {
      return mode === "aggressive" ? round(weight * 0.2) : 0;
    }
  }

  return round(weight * 0.5);
}

function scoreVolatility(indicators, weight, mode) {
  const atrClass = indicators?.atr?.class;

  if (atrClass === "medium") return weight;
  if (atrClass === "high") return mode === "aggressive" ? weight : round(weight * 0.75);
  if (atrClass === "low") return mode === "aggressive" ? round(weight * 0.45) : 0;

  return 0;
}

function getPreferredDirection(indicators) {
  const bullishVotes = [];
  const bearishVotes = [];

  if (isBullishTrend(indicators)) bullishVotes.push("trend");
  if (isBearishTrend(indicators)) bearishVotes.push("trend");

  if (indicators?.macd?.state === "bullish") bullishVotes.push("macd");
  if (indicators?.macd?.state === "bearish") bearishVotes.push("macd");

  if (indicators?.rsi?.zone === "bullish") bullishVotes.push("rsi");
  if (indicators?.rsi?.zone === "bearish") bearishVotes.push("rsi");

  if (indicators?.stochastic?.state === "bullish") bullishVotes.push("stochastic");
  if (indicators?.stochastic?.state === "bearish") bearishVotes.push("stochastic");

  if (bullishVotes.length > bearishVotes.length) return "CALL";
  if (bearishVotes.length > bullishVotes.length) return "PUT";

  return "WAIT";
}

function getBlockers(indicators, direction, modeProfile) {
  const blocks = [];

  if (direction === "WAIT") {
    blocks.push("Sem direção dominante entre tendência e momentum.");
    return blocks;
  }

  if (!modeProfile.blockers.allowWeakTrend && !isTrendStrong(indicators) && !isTrendDeveloping(indicators)) {
    blocks.push("Tendência fraca para o modo atual.");
  }

  if (!modeProfile.blockers.allowLowAtr && indicators?.atr?.class === "low") {
    blocks.push("Volatilidade insuficiente para entrada segura.");
  }

  if (
    direction === "CALL" &&
    !modeProfile.blockers.allowNearResistanceCall &&
    indicators?.structure?.zone === "near_resistance"
  ) {
    blocks.push("Preço muito próximo de resistência para CALL.");
  }

  if (
    direction === "PUT" &&
    !modeProfile.blockers.allowNearSupportPut &&
    indicators?.structure?.zone === "near_support"
  ) {
    blocks.push("Preço muito próximo de suporte para PUT.");
  }

  if (
    !modeProfile.blockers.allowCounterTrendTiming &&
    direction === "CALL" &&
    indicators?.stochastic?.state === "overbought"
  ) {
    blocks.push("Timing esticado para CALL.");
  }

  if (
    !modeProfile.blockers.allowCounterTrendTiming &&
    direction === "PUT" &&
    indicators?.stochastic?.state === "oversold"
  ) {
    blocks.push("Timing esticado para PUT.");
  }

  return blocks;
}

function getReasons(indicators, direction) {
  const reasons = [];

  if (direction === "CALL" && isBullishTrend(indicators)) {
    reasons.push("Alinhamento de tendência bullish por EMA/SMA.");
  }

  if (direction === "PUT" && isBearishTrend(indicators)) {
    reasons.push("Alinhamento de tendência bearish por EMA/SMA.");
  }

  if (direction === "CALL" && indicators?.adx?.state === "strong_bullish_trend") {
    reasons.push("ADX confirma força compradora.");
  }

  if (direction === "PUT" && indicators?.adx?.state === "strong_bearish_trend") {
    reasons.push("ADX confirma força vendedora.");
  }

  if (direction === "CALL" && indicators?.macd?.state === "bullish") {
    reasons.push("MACD com momentum comprador.");
  }

  if (direction === "PUT" && indicators?.macd?.state === "bearish") {
    reasons.push("MACD com momentum vendedor.");
  }

  if (direction === "CALL" && indicators?.rsi?.zone === "bullish") {
    reasons.push("RSI em faixa saudável para continuação de compra.");
  }

  if (direction === "PUT" && indicators?.rsi?.zone === "bearish") {
    reasons.push("RSI em faixa saudável para continuação de venda.");
  }

  if (direction === "CALL" && indicators?.structure?.zone === "near_support") {
    reasons.push("Preço próximo de suporte relevante.");
  }

  if (direction === "PUT" && indicators?.structure?.zone === "near_resistance") {
    reasons.push("Preço próximo de resistência relevante.");
  }

  if (indicators?.atr?.class === "medium") {
    reasons.push("Volatilidade equilibrada para execução.");
  }

  if (indicators?.atr?.class === "high") {
    reasons.push("Volatilidade elevada favorecendo deslocamento.");
  }

  return reasons;
}

function buildBreakdown(indicators, direction, mode, weights) {
  return {
    trend: scoreTrend(indicators, direction, weights.trend),
    adx: scoreADX(indicators, direction, weights.adx),
    momentum: scoreMACD(indicators, direction, weights.momentum),
    rsi: scoreRSI(indicators, direction, weights.rsi, mode),
    stochastic: scoreStochastic(indicators, direction, weights.stochastic, mode),
    bollinger: scoreBollinger(indicators, direction, weights.bollinger, mode),
    structure: scoreStructure(indicators, direction, weights.structure, mode),
    volatility: scoreVolatility(indicators, weights.volatility, mode)
  };
}

function sumBreakdown(breakdown) {
  return Object.values(breakdown).reduce((sum, value) => sum + Number(value || 0), 0);
}

function classifyEntryQuality(confidence) {
  if (confidence >= 90) return "institutional";
  if (confidence >= 82) return "high";
  if (confidence >= 72) return "good";
  if (confidence >= 60) return "moderate";
  return "weak";
}

function scoreStrategy(indicators, mode = "balanced") {
  if (!indicators?.valid) {
    return {
      signal: "WAIT",
      confidence: 0,
      reasons: [],
      blocks: [indicators?.reason || "Análise inválida."],
      entryQuality: "weak",
      breakdown: {}
    };
  }

  const profile = getModeProfile(mode);
  const direction = getPreferredDirection(indicators);

  const blocks = getBlockers(indicators, direction, profile);

  if (direction === "WAIT") {
    return {
      signal: "WAIT",
      confidence: 0,
      reasons: [],
      blocks,
      entryQuality: "weak",
      breakdown: {}
    };
  }

  const breakdown = buildBreakdown(indicators, direction, mode, profile.weights);
  let confidence = sumBreakdown(breakdown);

  if (blocks.length) {
    confidence -= blocks.length * 12;
  }

  confidence = clamp(round(confidence, 2), 0, 99);

  if (confidence < profile.minConfidence) {
    return {
      signal: "WAIT",
      confidence,
      reasons: getReasons(indicators, direction),
      blocks: [
        ...blocks,
        `Confiança abaixo do mínimo do modo ${mode}.`
      ],
      entryQuality: classifyEntryQuality(confidence),
      breakdown
    };
  }

  return {
    signal: direction,
    confidence,
    reasons: getReasons(indicators, direction),
    blocks,
    entryQuality: classifyEntryQuality(confidence),
    breakdown
  };
}

module.exports = {
  scoreStrategy,
  getModeProfile
};