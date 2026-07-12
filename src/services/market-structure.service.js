const config = require("../config/market-structure.config");

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(decimals));
}

function getClose(candle = {}) {
  return toNumber(candle.close ?? candle.c ?? candle.price);
}

function getHigh(candle = {}) {
  return toNumber(candle.high ?? candle.h ?? candle.close ?? candle.c);
}

function getLow(candle = {}) {
  return toNumber(candle.low ?? candle.l ?? candle.close ?? candle.c);
}

function percentDistance(a, b) {
  const left = toNumber(a);
  const right = toNumber(b);
  if (!left || !right) return 0;
  return Math.abs(left - right) / right * 100;
}

function getPivots(candles = [], type = "high") {
  const window = config.pivotWindow;
  const start = Math.max(0, candles.length - config.swingLookback);
  const slice = candles.slice(start);
  const pivots = [];

  for (let index = window; index < slice.length - window; index += 1) {
    const value = type === "high" ? getHigh(slice[index]) : getLow(slice[index]);
    if (value === null) continue;

    let pivot = true;
    for (let offset = index - window; offset <= index + window; offset += 1) {
      if (offset === index) continue;
      const compare = type === "high" ? getHigh(slice[offset]) : getLow(slice[offset]);
      if (compare === null) continue;
      if (type === "high" && compare >= value) pivot = false;
      if (type === "low" && compare <= value) pivot = false;
    }

    if (!pivot) continue;

    const previous = pivots[pivots.length - 1];
    if (previous && percentDistance(value, previous.value) < config.minSwingDistancePercent) continue;

    pivots.push({ index: start + index, value, time: slice[index].time || slice[index].datetime || null });
  }

  return pivots;
}

function classifySwing(current, previous, bullishLabel, bearishLabel) {
  if (!current || !previous) return null;
  return current.value >= previous.value ? bullishLabel : bearishLabel;
}

function detectLiquidityPools(highs = [], lows = []) {
  const pools = [];
  const tolerance = config.equalLevelTolerancePercent;

  const collect = (items, side) => {
    for (let index = 1; index < items.length; index += 1) {
      const current = items[index];
      const previous = items[index - 1];
      if (percentDistance(current.value, previous.value) <= tolerance) {
        pools.push({ side, price: round((current.value + previous.value) / 2, 6), touches: 2 });
      }
    }
  };

  collect(highs, "buy_side");
  collect(lows, "sell_side");

  return pools.slice(-6);
}

function detectLiquiditySweep(candles = [], pools = []) {
  const recent = candles.slice(-config.sweepLookback);
  const last = recent[recent.length - 1] || {};
  const close = getClose(last);
  if (!close) return null;

  for (const pool of pools.slice().reverse()) {
    const swept = recent.some((candle) => {
      const high = getHigh(candle);
      const low = getLow(candle);
      return pool.side === "buy_side" ? high > pool.price && close < pool.price : low < pool.price && close > pool.price;
    });

    if (swept) {
      return {
        detected: true,
        side: pool.side,
        price: pool.price,
        expectedDirection: pool.side === "sell_side" ? "CALL" : "PUT"
      };
    }
  }

  return { detected: false };
}

function analyzeTimeframe(timeframe, candles = []) {
  const highs = getPivots(candles, "high");
  const lows = getPivots(candles, "low");
  const lastHigh = highs[highs.length - 1] || null;
  const previousHigh = highs[highs.length - 2] || null;
  const lastLow = lows[lows.length - 1] || null;
  const previousLow = lows[lows.length - 2] || null;
  const highLabel = classifySwing(lastHigh, previousHigh, "HH", "LH");
  const lowLabel = classifySwing(lastLow, previousLow, "HL", "LL");
  const direction = highLabel === "HH" && lowLabel === "HL" ? "bullish" : highLabel === "LH" && lowLabel === "LL" ? "bearish" : "neutral";
  const lastClose = getClose(candles[candles.length - 1] || {});
  const bos = Boolean(direction === "bullish" && previousHigh && lastClose > previousHigh.value) || Boolean(direction === "bearish" && previousLow && lastClose < previousLow.value);
  const mss = Boolean(direction === "bullish" && previousLow && lastClose < previousLow.value) || Boolean(direction === "bearish" && previousHigh && lastClose > previousHigh.value);
  const pools = detectLiquidityPools(highs, lows);
  const sweep = detectLiquiditySweep(candles, pools);
  const retestReference = direction === "bullish" ? previousHigh : direction === "bearish" ? previousLow : null;
  const firstRetest = Boolean(retestReference && candles.slice(-config.firstRetestLookback).some((candle) => percentDistance(getClose(candle), retestReference.value) <= config.retestTolerancePercent));
  const structurePreserved = Boolean(direction !== "neutral" && !mss && ((direction === "bullish" && lowLabel === "HL") || (direction === "bearish" && highLabel === "LH")));

  return { timeframe, direction, swings: { high: highLabel, low: lowLabel }, bos, mss, liquidityPools: pools, liquiditySweep: sweep, firstRetest, structurePreserved };
}

function scoreTimeframe(analysis, expectedDirection) {
  const expectedStructure = expectedDirection === "CALL" ? "bullish" : expectedDirection === "PUT" ? "bearish" : null;
  let score = 50;
  const reasons = [];

  if (!expectedStructure || analysis.direction === "neutral") score -= config.score.neutralPenalty;
  else if (analysis.direction === expectedStructure) {
    score += config.score.alignedTrend;
    reasons.push(`Estrutura ${analysis.direction} alinhada`);
  } else {
    score -= config.score.oppositeStructurePenalty;
    reasons.push(`Estrutura ${analysis.direction} oposta`);
  }

  if (analysis.structurePreserved) score += config.score.structurePreserved;
  if (analysis.bos) score += config.score.bos;
  if (analysis.mss) score -= config.score.mss;
  if (analysis.firstRetest) score += config.score.firstRetest;
  if (analysis.liquiditySweep?.detected && analysis.liquiditySweep.expectedDirection === expectedDirection) score += config.score.liquiditySweepWithDirection;

  return { score: round(Math.max(0, Math.min(100, score))), reasons };
}

function analyze(snapshot = {}, strategy = {}) {
  const expectedDirection = strategy.signal || strategy.direction || null;
  const timeframes = {};
  let weightedScore = 0;
  const reasons = [];

  for (const timeframe of config.timeframes) {
    const analysis = analyzeTimeframe(timeframe, snapshot?.timeframes?.[timeframe]?.candles || []);
    const scoring = scoreTimeframe(analysis, expectedDirection);
    timeframes[timeframe] = { ...analysis, score: scoring.score };
    weightedScore += scoring.score * (config.timeframeWeights[timeframe] || 0);
    reasons.push(...scoring.reasons.map((reason) => `${timeframe}: ${reason}`));
  }

  const dominant = [timeframes.h1?.direction, timeframes.m15?.direction, timeframes.m5?.direction];
  const bullishCount = dominant.filter((item) => item === "bullish").length;
  const bearishCount = dominant.filter((item) => item === "bearish").length;
  const multiTimeframeStructure = bullishCount > bearishCount ? "bullish" : bearishCount > bullishCount ? "bearish" : "neutral";
  const expectedStructure = expectedDirection === "CALL" ? "bullish" : expectedDirection === "PUT" ? "bearish" : null;
  const rawAdjustment = expectedStructure && multiTimeframeStructure === expectedStructure
    ? (weightedScore - 50) / 4
    : expectedStructure && multiTimeframeStructure !== "neutral"
      ? (50 - weightedScore) / -4
      : (weightedScore - 50) / 8;
  const marketStructureAdjustment = round(Math.max(config.adjustment.maxPenalty, Math.min(config.adjustment.maxBonus, rawAdjustment)));
  const marketStructureScore = round(weightedScore);

  return {
    enabled: true,
    expectedDirection,
    multiTimeframeStructure,
    marketStructureScore,
    marketStructureAdjustment,
    timeframes,
    summary: buildSummary(multiTimeframeStructure, timeframes),
    reasons,
    audit: {
      scope: "aerix_market_structure_audit",
      event: "marketStructureEvaluation",
      timestamp: new Date().toISOString(),
      symbol: snapshot?.symbol || snapshot?.asset || null,
      expectedDirection,
      multiTimeframeStructure,
      marketStructureScore,
      marketStructureAdjustment
    }
  };
}

function buildSummary(structure, timeframes = {}) {
  const h1 = timeframes.h1?.swings || {};
  const label = structure === "bullish" ? "Alta" : structure === "bearish" ? "Baixa" : "Neutra";
  const swings = structure === "bullish" ? "HH/HL" : structure === "bearish" ? "LH/LL" : [h1.high, h1.low].filter(Boolean).join("/") || "--";
  return `${label} ${swings}`;
}

module.exports = { analyze, analyzeTimeframe };
