const {
  getLastADX,
  getADXState,
  getLastATR,
  classifyATR,
  getLastBollinger,
  getBollingerState,
  getLastEMAFromCandles,
  getLastMACD,
  getMACDState,
  getLastRSIFromCandles,
  getRSIZone,
  getLastSMAFromCandles,
  getLastStochastic,
  getStochasticState,
  getPriceZone
} = require("../indicators");

function getLastClose(candles = []) {
  if (!Array.isArray(candles) || !candles.length) return null;
  return Number(candles[candles.length - 1].close);
}

function buildTrendBias({ ema9, ema21, sma20, sma50 }) {
  if (
    Number.isFinite(ema9) &&
    Number.isFinite(ema21) &&
    Number.isFinite(sma20) &&
    Number.isFinite(sma50)
  ) {
    if (ema9 > ema21 && ema21 > sma20 && sma20 >= sma50) {
      return "bullish";
    }

    if (ema9 < ema21 && ema21 < sma20 && sma20 <= sma50) {
      return "bearish";
    }
  }

  return "neutral";
}

// 🔥 NOVO: força da tendência
function getTrendStrength(adx, trendBias) {
  if (!adx || trendBias === "neutral") return "weak";

  if (adx >= 35) return "very_strong";
  if (adx >= 25) return "strong";
  if (adx >= 18) return "moderate";
  return "weak";
}

// 🔥 NOVO: qualidade do mercado
function getMarketQuality({ trendBias, adx, atrClass, bollingerState }) {
  if (trendBias === "neutral") return "bad";

  if (adx >= 25 && atrClass === "high") return "excellent";
  if (adx >= 20 && atrClass !== "low") return "good";
  if (bollingerState === "squeeze") return "bad";

  return "moderate";
}

// 🔥 NOVO: timing de entrada
function getEntryTiming({ rsiZone, stochasticState, macdState }) {
  if (
    (rsiZone === "oversold" && stochasticState === "bullish_cross") ||
    (rsiZone === "overbought" && stochasticState === "bearish_cross")
  ) {
    return "perfect";
  }

  if (macdState === "bullish" || macdState === "bearish") {
    return "good";
  }

  return "bad";
}

// 🔥 NOVO: score institucional
function calculateMarketScore({
  trendBias,
  adx,
  atrClass,
  rsiZone,
  stochasticState
}) {
  let score = 0;

  if (trendBias !== "neutral") score += 20;
  if (adx >= 25) score += 25;
  if (adx >= 35) score += 10;

  if (atrClass === "high") score += 15;
  if (atrClass === "low") score -= 10;

  if (rsiZone === "oversold" || rsiZone === "overbought") score += 10;

  if (
    stochasticState === "bullish_cross" ||
    stochasticState === "bearish_cross"
  ) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

function analyzeIndicators(candles = [], mode = "balanced") {
  if (!Array.isArray(candles) || candles.length < 60) {
    return {
      valid: false,
      reason: "Poucos candles para análise."
    };
  }

  const price = getLastClose(candles);

  const ema9 = getLastEMAFromCandles(candles, 9);
  const ema21 = getLastEMAFromCandles(candles, 21);
  const sma20 = getLastSMAFromCandles(candles, 20);
  const sma50 = getLastSMAFromCandles(candles, 50);

  const trendBias = buildTrendBias({ ema9, ema21, sma20, sma50 });

  const { adx, plusDI, minusDI } = getLastADX(candles, 14);
  const adxState = getADXState(adx, plusDI, minusDI);

  const atr = getLastATR(candles, 14);
  const atrClass = classifyATR(atr);

  const { upper, middle, lower } = getLastBollinger(candles, 20, 2, "close");
  const bollingerState = getBollingerState(price, upper, middle, lower);

  const { macd, signal, histogram } = getLastMACD(candles, 12, 26, 9, "close");
  const macdState = getMACDState(macd, signal, histogram);

  const rsi = getLastRSIFromCandles(candles, 14, "close");
  const rsiZone = getRSIZone(rsi);

  const { k, d } = getLastStochastic(candles, 14, 3, 3);
  const stochasticState = getStochasticState(k, d);

  const structure = getPriceZone(candles, 40, 0.0004);

  // 🔥 NOVAS CAMADAS
  const trendStrength = getTrendStrength(adx, trendBias);
  const marketQuality = getMarketQuality({
    trendBias,
    adx,
    atrClass,
    bollingerState
  });

  const entryTiming = getEntryTiming({
    rsiZone,
    stochasticState,
    macdState
  });

  const marketScore = calculateMarketScore({
    trendBias,
    adx,
    atrClass,
    rsiZone,
    stochasticState
  });

  return {
    valid: true,
    mode,
    price,

    trend: {
      ema9,
      ema21,
      sma20,
      sma50,
      bias: trendBias,
      strength: trendStrength
    },

    adx: {
      value: adx,
      plusDI,
      minusDI,
      state: adxState
    },

    atr: {
      value: atr,
      class: atrClass
    },

    bollinger: {
      upper,
      middle,
      lower,
      state: bollingerState
    },

    macd: {
      macd,
      signal,
      histogram,
      state: macdState
    },

    rsi: {
      value: rsi,
      zone: rsiZone
    },

    stochastic: {
      k,
      d,
      state: stochasticState
    },

    structure,

    // 🔥 NOVO BLOCO FINAL
    marketContext: {
      quality: marketQuality,
      score: marketScore,
      entryTiming,
      trendStrength
    }
  };
}

module.exports = {
  analyzeIndicators
};