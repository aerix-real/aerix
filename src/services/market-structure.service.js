const { getLastATR } = require("../indicators/atr.indicator");
const {
  STRUCTURAL_TRENDS,
  OPERATIONAL_CONTEXTS,
  normalizeMarketStructureMode,
  getMarketStructureConfig
} = require("../config/market-structure.config");

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, decimals = 6) {
  const numeric = number(value);
  return numeric === null ? null : Number(numeric.toFixed(decimals));
}

function isClosedCandle(candle = {}) {
  if (candle.closed === false || candle.isClosed === false || candle.complete === false) return false;
  if (candle.closed === true || candle.isClosed === true || candle.complete === true) return true;
  return true;
}

function normalizeCandles(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .map((candle, index) => ({
      ...candle,
      index,
      open: number(candle.open),
      high: number(candle.high),
      low: number(candle.low),
      close: number(candle.close),
      timestamp: candle.timestamp || candle.time || candle.datetime || candle.date || index,
      closed: isClosedCandle(candle)
    }))
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every((value) => value !== null));
}

function getAtr(candles, atr) {
  const supplied = number(atr);
  if (supplied && supplied > 0) return supplied;
  const calculated = getLastATR(candles, 14);
  if (calculated && calculated > 0) return calculated;
  const last = candles[candles.length - 1];
  return last ? Math.max(Math.abs(last.high - last.low), last.close * 0.001, 0.000001) : 0.000001;
}

function makeAudit(event, payload) {
  return { scope: "aerix_market_structure_audit", event, timestamp: new Date().toISOString(), ...payload };
}

function isFarEnough(point, previousSameType, minDistance, equalTolerance = 0) {
  if (!previousSameType) return true;
  const distance = Math.abs(point.price - previousSameType.price);
  return distance >= minDistance || distance <= equalTolerance;
}

function detectSwings(candles, config, atr) {
  const closedCandles = candles.filter((candle) => candle.closed);
  const minDistance = atr * config.minimumSwingDistanceAtr;
  const equalTolerance = atr * config.equalLevelToleranceAtr;
  const swingHighs = [];
  const swingLows = [];

  for (let i = config.pivotLeft; i < closedCandles.length - config.pivotRight; i += 1) {
    const pivot = closedCandles[i];
    const left = closedCandles.slice(i - config.pivotLeft, i);
    const right = closedCandles.slice(i + 1, i + 1 + config.pivotRight);
    const highOk = left.every((candle) => pivot.high > candle.high) && right.every((candle) => pivot.high > candle.high);
    const lowOk = left.every((candle) => pivot.low < candle.low) && right.every((candle) => pivot.low < candle.low);

    if (highOk) {
      const point = { type: "HIGH", index: pivot.index, timestamp: pivot.timestamp, price: pivot.high, high: pivot.high, low: pivot.low };
      if (isFarEnough(point, swingHighs[swingHighs.length - 1], minDistance, equalTolerance)) swingHighs.push(point);
    }

    if (lowOk) {
      const point = { type: "LOW", index: pivot.index, timestamp: pivot.timestamp, price: pivot.low, high: pivot.high, low: pivot.low };
      if (isFarEnough(point, swingLows[swingLows.length - 1], minDistance, equalTolerance)) swingLows.push(point);
    }
  }

  return { swingHighs, swingLows };
}

function classifySwings(points, bullishLabel, bearishLabel, equalLabel, tolerance) {
  return points.map((point, index) => {
    if (index === 0) return { ...point, classification: null };
    const previous = points[index - 1];
    const diff = point.price - previous.price;
    if (Math.abs(diff) <= tolerance) return { ...point, classification: equalLabel };
    return { ...point, classification: diff > 0 ? bullishLabel : bearishLabel };
  });
}

function classifyTrend(swingHighs, swingLows) {
  const counts = [...swingHighs, ...swingLows].reduce((acc, point) => {
    if (point.classification) acc[point.classification] = (acc[point.classification] || 0) + 1;
    return acc;
  }, { HH: 0, HL: 0, LH: 0, LL: 0, EH: 0, EL: 0 });
  const directional = counts.HH + counts.HL + counts.LH + counts.LL;
  if (counts.EH >= 1 && counts.EL >= 1 && directional <= counts.EH + counts.EL + 1) return STRUCTURAL_TRENDS.RANGE;
  if (counts.HH + counts.HL >= Math.max(2, counts.LH + counts.LL + 1)) return STRUCTURAL_TRENDS.BULLISH;
  if (counts.LL + counts.LH >= Math.max(2, counts.HH + counts.HL + 1)) return STRUCTURAL_TRENDS.BEARISH;
  if (directional > 0) return STRUCTURAL_TRENDS.TRANSITION;
  return STRUCTURAL_TRENDS.UNDEFINED;
}

function detectBos(candles, lastSwingHigh, lastSwingLow, trend, config, atr) {
  const last = candles[candles.length - 1];
  const buffer = atr * config.bosBufferAtr;
  const empty = { detected: false, direction: null, brokenLevel: null, breakoutPrice: null, candleTimestamp: last?.timestamp || null, displacement: 0, confirmedByClose: false, strength: 0 };
  if (!last || !last.closed) return empty;

  const bullishAllowed = lastSwingHigh && [STRUCTURAL_TRENDS.BULLISH, STRUCTURAL_TRENDS.TRANSITION, STRUCTURAL_TRENDS.UNDEFINED].includes(trend);
  const bearishAllowed = lastSwingLow && [STRUCTURAL_TRENDS.BEARISH, STRUCTURAL_TRENDS.TRANSITION, STRUCTURAL_TRENDS.UNDEFINED].includes(trend);
  let candidate = null;

  if (bullishAllowed) {
    for (const candle of candles.filter((item) => item.index > lastSwingHigh.index)) {
      if (candle.closed && candle.close > lastSwingHigh.price + buffer) {
        const displacement = candle.close - lastSwingHigh.price;
        candidate = { detected: true, direction: "BULLISH", brokenLevel: lastSwingHigh.price, breakoutPrice: candle.close, candleTimestamp: candle.timestamp, displacement: round(displacement), confirmedByClose: true, strength: round(Math.min(100, (displacement / atr) * 35), 2) };
        break;
      }
    }
  }

  if (!candidate && bearishAllowed) {
    for (const candle of candles.filter((item) => item.index > lastSwingLow.index)) {
      if (candle.closed && candle.close < lastSwingLow.price - buffer) {
        const displacement = lastSwingLow.price - candle.close;
        candidate = { detected: true, direction: "BEARISH", brokenLevel: lastSwingLow.price, breakoutPrice: candle.close, candleTimestamp: candle.timestamp, displacement: round(displacement), confirmedByClose: true, strength: round(Math.min(100, (displacement / atr) * 35), 2) };
        break;
      }
    }
  }

  return candidate || empty;
}

function detectMss(candles, swingHighs, swingLows, trend, config, atr) {
  const last = candles[candles.length - 1];
  const buffer = atr * config.bosBufferAtr;
  const empty = { detected: false, previousTrend: trend, probableNewTrend: null, brokenStructureLevel: null, confirmationState: "POTENTIAL", retestPending: false, confidence: 0 };
  if (!last || !last.closed) return empty;
  const lastLow = [...swingLows].reverse().find((p) => ["HL", null].includes(p.classification));
  const lastHigh = [...swingHighs].reverse().find((p) => ["LH", null].includes(p.classification));
  if (trend === STRUCTURAL_TRENDS.BULLISH && lastLow && last.close < lastLow.price - buffer) return { detected: true, previousTrend: trend, probableNewTrend: STRUCTURAL_TRENDS.BEARISH, brokenStructureLevel: lastLow.price, confirmationState: "CONFIRMED", retestPending: true, confidence: 72 };
  if (trend === STRUCTURAL_TRENDS.BEARISH && lastHigh && last.close > lastHigh.price + buffer) return { detected: true, previousTrend: trend, probableNewTrend: STRUCTURAL_TRENDS.BULLISH, brokenStructureLevel: lastHigh.price, confirmationState: "CONFIRMED", retestPending: true, confidence: 72 };
  return empty;
}

function groupLiquidity(points, type, tolerance) {
  const levels = [];
  points.forEach((point) => {
    const level = levels.find((item) => Math.abs(item.price - point.price) <= tolerance);
    if (level) {
      level.touches += 1;
      level.price = round((level.price * (level.touches - 1) + point.price) / level.touches);
      level.lastTouchedAt = point.timestamp;
      level.relevance = Math.min(100, level.relevance + 15);
    } else {
      levels.push({ type, price: round(point.price), touches: 1, firstDetectedAt: point.timestamp, lastTouchedAt: point.timestamp, swept: false, relevance: 35 });
    }
  });
  return levels.filter((level) => level.touches >= 2);
}

function detectLiquiditySweep(candles, levels, trend, atr) {
  const last = candles[candles.length - 1];
  if (!last || !last.closed) return [];
  return levels.map((level) => {
    const topSweep = level.type === "BUY_SIDE_LIQUIDITY" && last.high > level.price && last.close < level.price;
    const bottomSweep = level.type === "SELL_SIDE_LIQUIDITY" && last.low < level.price && last.close > level.price;
    if (!topSweep && !bottomSweep) return null;
    const sweepDistance = topSweep ? last.high - level.price : level.price - last.low;
    return {
      liquidityLevelDetected: true,
      sweepDetected: true,
      closeBackInsideRange: true,
      sweptLevel: level.price,
      direction: topSweep ? "PUT" : "CALL",
      sweepDistance: round(sweepDistance),
      rejectionQuality: round(Math.min(100, (sweepDistance / atr) * 60), 2),
      previousStructure: trend,
      structureAfterSweep: STRUCTURAL_TRENDS.TRANSITION,
      candleTimestamp: last.timestamp
    };
  }).filter(Boolean);
}

function detectFirstRetest(candles, bos, config, atr, mss) {
  const empty = { detected: false, direction: null, breakoutLevel: null, breakoutTimestamp: null, displacementDistance: 0, retestCount: 0, isFirstRetest: false, touchDistance: null, structureHolding: true, confirmationPending: false, invalidated: false };
  if (!bos.detected) return empty;
  const start = candles.findIndex((candle) => candle.timestamp === bos.candleTimestamp);
  if (start < 0) return empty;
  const zone = atr * config.retestZoneAtr;
  let movedAway = false;
  let retestCount = 0;
  let touchDistance = null;
  for (let i = start + 1; i < candles.length; i += 1) {
    const candle = candles[i];
    const distance = bos.direction === "BULLISH" ? candle.high - bos.brokenLevel : bos.brokenLevel - candle.low;
    if (distance >= atr * config.minimumDisplacementAtr) movedAway = true;
    const touched = movedAway && candle.low <= bos.brokenLevel + zone && candle.high >= bos.brokenLevel - zone;
    if (touched) {
      retestCount += 1;
      touchDistance = Math.min(Math.abs(candle.low - bos.brokenLevel), Math.abs(candle.high - bos.brokenLevel));
    }
  }
  const invalidated = mss.detected && mss.confirmationState === "CONFIRMED";
  return { detected: retestCount > 0, direction: bos.direction, breakoutLevel: bos.brokenLevel, breakoutTimestamp: bos.candleTimestamp, displacementDistance: bos.displacement, retestCount, isFirstRetest: retestCount === 1, touchDistance: round(touchDistance), structureHolding: !invalidated, confirmationPending: retestCount === 1, invalidated };
}

function structurePreserved(direction, { lastSwingHigh, lastSwingLow, mss, candles }) {
  const last = candles[candles.length - 1];
  if (!last || !last.closed) return false;
  if (direction === "CALL") return Boolean(lastSwingLow && last.close >= lastSwingLow.price && !(mss.detected && mss.probableNewTrend === STRUCTURAL_TRENDS.BEARISH));
  if (direction === "PUT") return Boolean(lastSwingHigh && last.close <= lastSwingHigh.price && !(mss.detected && mss.probableNewTrend === STRUCTURAL_TRENDS.BULLISH));
  return false;
}

function calculateMarketStructureScore({ trend, bos, mss, firstRetest, liquiditySweeps, counts }) {
  let score = 0;
  if (trend === STRUCTURAL_TRENDS.BULLISH) score += 48;
  if (trend === STRUCTURAL_TRENDS.BEARISH) score -= 48;
  if (trend === STRUCTURAL_TRENDS.RANGE) score += 0;
  score += Math.min(20, (counts.HH + counts.HL) * 5);
  score -= Math.min(20, (counts.LH + counts.LL) * 5);
  if (bos.detected) score += bos.direction === "BULLISH" ? 18 : -18;
  if (mss.detected) score += mss.probableNewTrend === STRUCTURAL_TRENDS.BULLISH ? 22 : -22;
  if (firstRetest.isFirstRetest) score += firstRetest.direction === "BULLISH" ? 10 : -10;
  liquiditySweeps.forEach((sweep) => { score += sweep.direction === "CALL" ? 8 : -8; });
  return Math.max(-100, Math.min(100, Math.round(score)));
}

function analyzeMarketStructure({ candles = [], timeframe = null, symbol = null, mode = "balanced", volatility = null, atr = null } = {}) {
  const operationalMode = normalizeMarketStructureMode(mode);
  const config = getMarketStructureConfig(operationalMode);
  const normalizedCandles = normalizeCandles(candles);
  const closedCandles = normalizedCandles.filter((candle) => candle.closed);
  const effectiveAtr = getAtr(closedCandles, atr);
  const audit = [];
  if (closedCandles.length < config.pivotLeft + config.pivotRight + 5) {
    return { timeframe, swingHighs: [], swingLows: [], lastSwingHigh: null, lastSwingLow: null, previousSwingHigh: null, previousSwingLow: null, structuralTrend: STRUCTURAL_TRENDS.UNDEFINED, dominantDirection: "NEUTRAL", structureStrength: 0, structureState: "INSUFFICIENT_DATA", bos: { detected: false }, mss: { detected: false }, liquidityLevels: [], liquiditySweeps: [], firstRetest: { detected: false }, range: null, supportLevels: [], resistanceLevels: [], invalidationLevel: null, confidence: 0, marketStructureScore: 0, hardBlocks: ["insufficientSwingPoints"], audit: [makeAudit("structure_invalidated", { symbol, timeframe, operationalMode, reason: "insufficientSwingPoints" })] };
  }
  const detected = detectSwings(closedCandles, config, effectiveAtr);
  let swingHighs = classifySwings(detected.swingHighs, "HH", "LH", "EH", effectiveAtr * config.equalLevelToleranceAtr);
  let swingLows = classifySwings(detected.swingLows, "HL", "LL", "EL", effectiveAtr * config.equalLevelToleranceAtr);
  const trend = classifyTrend(swingHighs, swingLows);
  const counts = [...swingHighs, ...swingLows].reduce((acc, point) => {
    if (point.classification) acc[point.classification] = (acc[point.classification] || 0) + 1;
    return acc;
  }, { HH: 0, HL: 0, LH: 0, LL: 0, EH: 0, EL: 0 });
  const lastSwingHigh = swingHighs[swingHighs.length - 1] || null;
  const lastSwingLow = swingLows[swingLows.length - 1] || null;
  const previousSwingHigh = swingHighs[swingHighs.length - 2] || null;
  const previousSwingLow = swingLows[swingLows.length - 2] || null;
  const bos = detectBos(closedCandles, lastSwingHigh, lastSwingLow, trend, config, effectiveAtr);
  const mss = detectMss(closedCandles, swingHighs, swingLows, trend, config, effectiveAtr);
  const liquidityLevels = [
    ...groupLiquidity(swingHighs, "BUY_SIDE_LIQUIDITY", effectiveAtr * config.equalLevelToleranceAtr),
    ...groupLiquidity(swingLows, "SELL_SIDE_LIQUIDITY", effectiveAtr * config.equalLevelToleranceAtr)
  ];
  const liquiditySweeps = detectLiquiditySweep(closedCandles, liquidityLevels, trend, effectiveAtr);
  const firstRetest = detectFirstRetest(closedCandles, bos, config, effectiveAtr, mss);
  const supportLevels = swingLows.slice(-3).map((point) => round(point.price));
  const resistanceLevels = swingHighs.slice(-3).map((point) => round(point.price));
  const range = supportLevels.length && resistanceLevels.length ? { support: Math.min(...supportLevels), resistance: Math.max(...resistanceLevels) } : null;
  const dominantDirection = trend === STRUCTURAL_TRENDS.BULLISH ? "CALL" : trend === STRUCTURAL_TRENDS.BEARISH ? "PUT" : "NEUTRAL";
  const structureState = mss.detected ? "TRANSITION" : bos.detected ? "BREAKOUT_CONFIRMED" : liquiditySweeps.length ? "LIQUIDITY_SWEEP" : trend;
  const marketStructureScore = calculateMarketStructureScore({ trend, bos, mss, firstRetest, liquiditySweeps, counts });
  const confidence = Math.min(100, Math.abs(marketStructureScore) + Math.min(25, swingHighs.length + swingLows.length));
  const invalidationLevel = dominantDirection === "CALL" ? lastSwingLow?.price || null : dominantDirection === "PUT" ? lastSwingHigh?.price || null : null;

  audit.push(makeAudit("swing_points_detected", { symbol, timeframe, operationalMode, swingHighCount: swingHighs.length, swingLowCount: swingLows.length, lastSwingHigh, lastSwingLow }));
  audit.push(makeAudit("structure_classified", { symbol, timeframe, operationalMode, structuralTrend: trend, structureState, HH: counts.HH, HL: counts.HL, LH: counts.LH, LL: counts.LL, equalHighs: counts.EH, equalLows: counts.EL }));
  if (bos.detected) audit.push(makeAudit("bos_detected", { symbol, timeframe, bos }));
  if (mss.detected) audit.push(makeAudit("mss_detected", { symbol, timeframe, mss }));
  if (liquidityLevels.length) audit.push(makeAudit("liquidity_pool_detected", { symbol, timeframe, liquidityLevels }));
  if (liquiditySweeps.length) audit.push(makeAudit("liquidity_sweep_detected", { symbol, timeframe, sweep: liquiditySweeps[0] }));
  if (firstRetest.detected) audit.push(makeAudit("first_retest_detected", { symbol, timeframe, firstRetest }));

  return { timeframe, symbol, mode: operationalMode, volatility, atr: round(effectiveAtr), swingHighs, swingLows, lastSwingHigh, lastSwingLow, previousSwingHigh, previousSwingLow, structuralTrend: trend, dominantDirection, structureStrength: confidence, structureState, bos, mss, liquidityLevels, liquiditySweeps, firstRetest, range, supportLevels, resistanceLevels, invalidationLevel: round(invalidationLevel), confidence, marketStructureScore, structurePreserved: { CALL: structurePreserved("CALL", { lastSwingHigh, lastSwingLow, mss, candles: closedCandles }), PUT: structurePreserved("PUT", { lastSwingHigh, lastSwingLow, mss, candles: closedCandles }) }, hardBlocks: normalizedCandles.some((candle, index) => index === normalizedCandles.length - 1 && !candle.closed) ? ["candleNotClosed"] : [], audit };
}

function directionFromTrend(structure) {
  if (structure?.structuralTrend === STRUCTURAL_TRENDS.BULLISH) return "CALL";
  if (structure?.structuralTrend === STRUCTURAL_TRENDS.BEARISH) return "PUT";
  return null;
}

function resolveOperationalContext(structures) {
  if (structures.some((item) => item?.firstRetest?.isFirstRetest)) return OPERATIONAL_CONTEXTS.FIRST_RETEST;
  if (structures.some((item) => item?.liquiditySweeps?.length)) return OPERATIONAL_CONTEXTS.LIQUIDITY_SWEEP;
  if (structures.some((item) => item?.mss?.detected)) return OPERATIONAL_CONTEXTS.REVERSAL_TRANSITION;
  if (structures.some((item) => item?.bos?.detected)) return OPERATIONAL_CONTEXTS.BREAKOUT;
  if (structures.some((item) => item?.structuralTrend === STRUCTURAL_TRENDS.RANGE)) return OPERATIONAL_CONTEXTS.RANGE;
  if (structures.filter((item) => [STRUCTURAL_TRENDS.BULLISH, STRUCTURAL_TRENDS.BEARISH].includes(item?.structuralTrend)).length >= 2) return OPERATIONAL_CONTEXTS.TREND_CONTINUATION;
  return OPERATIONAL_CONTEXTS.NO_CLEAR_STRUCTURE;
}

function analyzeMultiTimeframeStructure({ h1 = null, m15 = null, m5 = null } = {}) {
  const structures = [h1, m15, m5].filter(Boolean);
  const directions = structures.map(directionFromTrend).filter(Boolean);
  const callCount = directions.filter((direction) => direction === "CALL").length;
  const putCount = directions.filter((direction) => direction === "PUT").length;
  const dominantDirection = callCount > putCount ? "CALL" : putCount > callCount ? "PUT" : "NEUTRAL";
  const alignmentCount = Math.max(callCount, putCount);
  const structuralAlignment = alignmentCount === 3 ? "3/3" : alignmentCount === 2 ? "2/3" : "1/3_OR_CONFLICT";
  const conflict = Boolean(callCount > 0 && putCount > 0) || alignmentCount < 2;
  const avgScore = structures.length ? structures.reduce((sum, item) => sum + Number(item.marketStructureScore || 0), 0) / structures.length : 0;
  const result = { h1Structure: h1, m15Structure: m15, m5Structure: m5, structuralAlignment, dominantDirection, conflict, operationalContext: resolveOperationalContext(structures), confidence: Math.round(Math.min(100, Math.abs(avgScore) + alignmentCount * 12)), marketStructureScore: Math.max(-100, Math.min(100, Math.round(avgScore))), audit: [makeAudit("multi_timeframe_structure_resolved", { structuralAlignment, dominantDirection, conflict })] };
  return result;
}

function applyMarketStructureScore({ rawStrategyScore = 0, strategyDirection = null, marketStructure = null, mode = "balanced" } = {}) {
  const config = getMarketStructureConfig(mode);
  const score = Number(marketStructure?.marketStructureScore || 0);
  if (!rawStrategyScore || !strategyDirection) return { rawStrategyScore, marketStructureScore: score, marketStructureAdjustment: 0, scoreAfterStructureAdjustment: rawStrategyScore };
  let adjustment = 0;
  const aligned = (strategyDirection === "CALL" && score > 0) || (strategyDirection === "PUT" && score < 0);
  const againstMss = marketStructure?.mss?.detected && ((strategyDirection === "CALL" && marketStructure.mss.probableNewTrend === STRUCTURAL_TRENDS.BEARISH) || (strategyDirection === "PUT" && marketStructure.mss.probableNewTrend === STRUCTURAL_TRENDS.BULLISH));
  if (aligned) adjustment += Math.min(4, Math.ceil(Math.abs(score) / 25));
  if (marketStructure?.bos?.detected && ((strategyDirection === "CALL" && marketStructure.bos.direction === "BULLISH") || (strategyDirection === "PUT" && marketStructure.bos.direction === "BEARISH"))) adjustment += 2;
  if (marketStructure?.firstRetest?.isFirstRetest) adjustment += 3;
  if (marketStructure?.liquiditySweeps?.some((sweep) => sweep.direction === strategyDirection)) adjustment += 3;
  if (againstMss) adjustment -= 6;
  if (marketStructure?.structuralTrend === STRUCTURAL_TRENDS.RANGE) adjustment -= 2;
  adjustment = Math.max(-config.maxScoreAdjustment, Math.min(config.maxScoreAdjustment, adjustment));
  return { rawStrategyScore, marketStructureScore: score, marketStructureAdjustment: adjustment, scoreAfterStructureAdjustment: round(Number(rawStrategyScore) + adjustment, 2), audit: makeAudit("structure_score_applied", { marketStructureScore: score, marketStructureAdjustment: adjustment, scoreBeforeAdjustment: rawStrategyScore, scoreAfterAdjustment: round(Number(rawStrategyScore) + adjustment, 2) }) };
}

module.exports = {
  analyzeMarketStructure,
  analyzeMultiTimeframeStructure,
  applyMarketStructureScore,
  structurePreserved,
  normalizeMarketStructureMode
};
