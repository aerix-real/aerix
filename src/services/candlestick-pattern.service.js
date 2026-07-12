const { candlestickPatternRegistry, DIRECTION } = require("../config/candlestick-pattern-registry");

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function closed(c){ return c && c.closed !== false && c.isClosed !== false && c.complete !== false && c.isFinal !== false; }
function body(c){ return Math.abs(n(c.close) - n(c.open)); }
function range(c){ return Math.max(0.0000001, n(c.high) - n(c.low)); }
function upper(c){ return n(c.high) - Math.max(n(c.open), n(c.close)); }
function lower(c){ return Math.min(n(c.open), n(c.close)) - n(c.low); }
function bull(c){ return n(c.close) > n(c.open); }
function bear(c){ return n(c.close) < n(c.open); }
function smallBody(c, pct = 0.33){ return body(c) <= range(c) * pct; }
function strongBody(c, pct = 0.55){ return body(c) >= range(c) * pct; }
function mid(c){ return (n(c.open) + n(c.close)) / 2; }
function near(a,b,t){ return Math.abs(n(a)-n(b)) <= Math.max(range({ high: Math.max(n(a),n(b)), low: Math.min(n(a),n(b)) }), Math.abs(n(a))*0.0008, 0.0001) * (t || 1); }
function last(arr,count){ return arr.slice(Math.max(0, arr.length-count)); }
function allClosed(cs){ return cs.length > 0 && cs.every(closed); }
function directionTrend(context, dir){
  const trend = context.trendContext || context.mtf || {};
  const h1 = trend.h1?.trend || trend.h1?.direction || trend.h1 || "neutral";
  const m15 = trend.m15?.trend || trend.m15?.direction || trend.m15 || "neutral";
  const want = dir === DIRECTION.CALL ? "up" : "down";
  return [h1,m15].filter((x) => x === want).length;
}
function hasContext(context, keys){ return keys.some((k) => Boolean(context[k] || context.supportResistanceContext?.[k] || context.liquidityContext?.[k] || context.structureContext?.[k])); }
function isSupport(context){ return hasContext(context,["atSupport","nearSupport","support","sweepBelowSupport","afterLiquiditySweep"]); }
function isResistance(context){ return hasContext(context,["atResistance","nearResistance","resistance","sweepAboveResistance","afterLiquiditySweep"]); }

const detectors = {
  hammer: ([c]) => smallBody(c) && lower(c) >= body(c)*2 && upper(c) <= range(c)*0.25,
  invertedHammer: ([c], ctx, next) => smallBody(c) && upper(c) >= body(c)*2 && lower(c) <= range(c)*0.25 && (!next || bull(next)),
  hangingMan: ([c], ctx) => detectors.hammer([c]) && isResistance(ctx),
  shootingStar: ([c], ctx) => smallBody(c) && upper(c) >= body(c)*2 && lower(c) <= range(c)*0.25 && isResistance(ctx),
  bullishPinBar: ([c]) => lower(c) >= range(c)*0.55 && n(c.close) > (n(c.low)+range(c)*0.5),
  bearishPinBar: ([c]) => upper(c) >= range(c)*0.55 && n(c.close) < (n(c.low)+range(c)*0.5),
  bullishMarubozu: ([c]) => bull(c) && strongBody(c,0.75) && upper(c) <= range(c)*0.12 && lower(c) <= range(c)*0.12,
  bearishMarubozu: ([c]) => bear(c) && strongBody(c,0.75) && upper(c) <= range(c)*0.12 && lower(c) <= range(c)*0.12,
  doji: ([c]) => body(c) <= range(c)*0.1,
  spinningTop: ([c]) => body(c) > range(c)*0.1 && body(c) <= range(c)*0.33 && upper(c) >= body(c)*0.7 && lower(c) >= body(c)*0.7,
  bullishEngulfing: ([a,b]) => bear(a) && bull(b) && n(b.open) <= n(a.close) && n(b.close) >= n(a.open),
  bearishEngulfing: ([a,b]) => bull(a) && bear(b) && n(b.open) >= n(a.close) && n(b.close) <= n(a.open),
  bullishHarami: ([a,b]) => bear(a) && bull(b) && n(b.open) > n(a.close) && n(b.close) < n(a.open),
  bearishHarami: ([a,b]) => bull(a) && bear(b) && n(b.open) < n(a.close) && n(b.close) > n(a.open),
  piercingLine: ([a,b]) => bear(a) && bull(b) && n(b.open) < n(a.close) && n(b.close) > mid(a) && n(b.close) < n(a.open),
  darkCloudCover: ([a,b]) => bull(a) && bear(b) && n(b.open) > n(a.close) && n(b.close) < mid(a) && n(b.close) > n(a.open),
  tweezerBottom: ([a,b]) => near(a.low,b.low,1.5) && (lower(a) > body(a) || lower(b) > body(b)),
  tweezerTop: ([a,b]) => near(a.high,b.high,1.5) && (upper(a) > body(a) || upper(b) > body(b)),
  bullishOutsideBar: ([a,b]) => bull(b) && n(b.high) > n(a.high) && n(b.low) < n(a.low),
  bearishOutsideBar: ([a,b]) => bear(b) && n(b.high) > n(a.high) && n(b.low) < n(a.low),
  bullishInsideBarBreak: ([a,b,c]) => n(b.high) < n(a.high) && n(b.low) > n(a.low) && bull(c) && n(c.close) > n(b.high),
  bearishInsideBarBreak: ([a,b,c]) => n(b.high) < n(a.high) && n(b.low) > n(a.low) && bear(c) && n(c.close) < n(b.low),
  morningStar: ([a,b,c]) => bear(a) && smallBody(b,0.4) && bull(c) && n(c.close) > mid(a),
  eveningStar: ([a,b,c]) => bull(a) && smallBody(b,0.4) && bear(c) && n(c.close) < mid(a),
  morningDojiStar: (cs) => detectors.morningStar(cs) && detectors.doji([cs[1]]),
  eveningDojiStar: (cs) => detectors.eveningStar(cs) && detectors.doji([cs[1]]),
  threeWhiteSoldiers: (cs) => cs.length===3 && cs.every((c)=>bull(c)&&strongBody(c,0.45)) && n(cs[2].close)>n(cs[1].close)&&n(cs[1].close)>n(cs[0].close),
  threeBlackCrows: (cs) => cs.length===3 && cs.every((c)=>bear(c)&&strongBody(c,0.45)) && n(cs[2].close)<n(cs[1].close)&&n(cs[1].close)<n(cs[0].close),
  threeInsideUp: ([a,b,c]) => detectors.bullishHarami([a,b]) && bull(c) && n(c.close)>n(a.open),
  threeInsideDown: ([a,b,c]) => detectors.bearishHarami([a,b]) && bear(c) && n(c.close)<n(a.open),
  threeOutsideUp: ([a,b,c]) => detectors.bullishEngulfing([a,b]) && bull(c) && n(c.close)>n(b.close),
  threeOutsideDown: ([a,b,c]) => detectors.bearishEngulfing([a,b]) && bear(c) && n(c.close)<n(b.close),
  bullishAbandonedBaby: ([a,b,c]) => bear(a) && detectors.doji([b]) && bull(c) && n(b.high)<n(a.low) && n(c.low)>n(b.high),
  bearishAbandonedBaby: ([a,b,c]) => bull(a) && detectors.doji([b]) && bear(c) && n(b.low)>n(a.high) && n(c.high)<n(b.low),
  risingThreeMethods: (cs) => cs.length===5 && bull(cs[0]) && bull(cs[4]) && cs.slice(1,4).every(bear) && n(cs[4].close)>n(cs[0].close),
  fallingThreeMethods: (cs) => cs.length===5 && bear(cs[0]) && bear(cs[4]) && cs.slice(1,4).every(bull) && n(cs[4].close)<n(cs[0].close),
  bullishFlagCandleSequence: (cs) => bull(cs[0]) && cs.slice(1,4).every((c)=>range(c)<range(cs[0])) && bull(cs[4]) && n(cs[4].close)>Math.max(...cs.slice(1,4).map((c)=>n(c.high))),
  bearishFlagCandleSequence: (cs) => bear(cs[0]) && cs.slice(1,4).every((c)=>range(c)<range(cs[0])) && bear(cs[4]) && n(cs[4].close)<Math.min(...cs.slice(1,4).map((c)=>n(c.low))),
  bullishConsolidationBreak: (cs) => bull(cs[4]) && n(cs[4].close)>Math.max(...cs.slice(0,4).map((c)=>n(c.high))),
  bearishConsolidationBreak: (cs) => bear(cs[4]) && n(cs[4].close)<Math.min(...cs.slice(0,4).map((c)=>n(c.low))),
  firstRetestBullishConfirmation: ([a,b], ctx) => hasContext(ctx,["firstRetest","firstRetestDetected"]) && bull(b) && n(b.close)>=n(a.close),
  firstRetestBearishConfirmation: ([a,b], ctx) => hasContext(ctx,["firstRetest","firstRetestDetected"]) && bear(b) && n(b.close)<=n(a.close)
};

function scorePattern(pattern, context, confirmationCandlePresent){
  let score = pattern.baseWeight;
  if (pattern.expectedDirection === DIRECTION.CALL && isSupport(context)) score += 10;
  if (pattern.expectedDirection === DIRECTION.PUT && isResistance(context)) score += 10;
  if (hasContext(context,["liquiditySweep","afterLiquiditySweep","sweepDetected"])) score += 8;
  if (hasContext(context,["firstRetest","firstRetestDetected","retracementDetected","structurePreserved","momentumReturning"])) score += 6;
  score += directionTrend(context, pattern.expectedDirection) * 6;
  if (confirmationCandlePresent) score += 6;
  if (context.lowVolatility || context.marketRegime === "LOW_VOLATILITY") score -= 8;
  if (!isSupport(context) && !isResistance(context) && !hasContext(context,["liquiditySweep","firstRetest","retracementDetected"])) score -= 6;
  return Math.max(0, Math.min(40, score));
}

function analyzeCandlestickPatterns({ candles = [], context = {}, strategy = {}, mode = "balanced", timeframe = "m5" } = {}){
  const closedCandles = candles.filter(closed);
  const hasOpenCandle = candles.length > closedCandles.length;
  const auditEvents = [];
  if (hasOpenCandle) auditEvents.push("candleNotClosed");
  if (closedCandles.length < 2) auditEvents.push("candlestickPatternMissing");

  const detectedPatterns = [];
  for (const pattern of candlestickPatternRegistry.filter((p)=>p.enabled)) {
    if (closedCandles.length < pattern.candleCount) continue;
    const sample = last(closedCandles, pattern.candleCount);
    const detector = detectors[pattern.handler];
    const confirmationCandlePresent = pattern.confirmationRequired ? closedCandles.length > pattern.candleCount : true;
    if (!detector || !allClosed(sample)) continue;
    if (pattern.confirmationRequired && !confirmationCandlePresent) { auditEvents.push("confirmationCandleMissing"); continue; }
    if (!detector(sample, context, closedCandles[closedCandles.length - 1])) continue;
    const patternScore = scorePattern(pattern, context, confirmationCandlePresent);
    if (patternScore <= 0) auditEvents.push("invalidPatternContext");
    detectedPatterns.push({
      name: pattern.name,
      displayName: pattern.displayName,
      family: pattern.family,
      expectedDirection: pattern.expectedDirection,
      candleCount: pattern.candleCount,
      confidence: patternScore,
      confirmationRequired: pattern.confirmationRequired,
      confirmationCandlePresent,
      candlesUsed: sample.map((c)=>c.time || c.timestamp || null)
    });
  }

  let bullishScore = detectedPatterns.filter((p)=>p.expectedDirection===DIRECTION.CALL).reduce((s,p)=>s+p.confidence,0);
  let bearishScore = detectedPatterns.filter((p)=>p.expectedDirection===DIRECTION.PUT).reduce((s,p)=>s+p.confidence,0);
  const neutralScore = detectedPatterns.filter((p)=>p.expectedDirection===DIRECTION.NEUTRAL).reduce((s,p)=>s+p.confidence,0);
  const conflicts = { patternConflict: bullishScore > 0 && bearishScore > 0, candlestickDirectionConflict: false, hardBlock: false, reasons: [] };
  if (conflicts.patternConflict) { bullishScore *= 0.65; bearishScore *= 0.65; conflicts.reasons.push("opposing_patterns_detected"); }
  let dominantPatternDirection = "NEUTRAL";
  if (bullishScore - bearishScore >= 10) dominantPatternDirection = DIRECTION.CALL;
  if (bearishScore - bullishScore >= 10) dominantPatternDirection = DIRECTION.PUT;
  if (strategy.direction && dominantPatternDirection !== "NEUTRAL" && dominantPatternDirection !== strategy.direction) {
    conflicts.candlestickDirectionConflict = true;
    conflicts.reasons.push("patternDirectionConflict");
    auditEvents.push("patternDirectionConflict");
  }
  const raw = Math.max(-100, Math.min(100, bullishScore - bearishScore));
  const patternConfidence = Math.min(100, Math.abs(raw));
  const caps = { conservative: 4, balanced: 6, aggressive: 6 };
  const cap = caps[String(mode).toLowerCase()] || 6;
  const directionalSign = strategy.direction === DIRECTION.PUT ? -1 : 1;
  let candlestickAdjustment = Number(((raw / 100) * cap * directionalSign).toFixed(2));
  if (!strategy.direction || detectedPatterns.length === 0) candlestickAdjustment = 0;
  if (conflicts.candlestickDirectionConflict) candlestickAdjustment = Math.min(candlestickAdjustment, -2);
  candlestickAdjustment = Math.max(-cap, Math.min(cap, candlestickAdjustment));
  const rawStrategyScore = n(strategy.rawScore ?? strategy.score);
  const scoreAfterCandlestickAdjustment = Number(Math.max(0, Math.min(100, rawStrategyScore + candlestickAdjustment)).toFixed(2));
  const audit = {
    scope: "aerix_candlestick_pattern_audit",
    timestamp: new Date().toISOString(),
    symbol: context.symbol || null,
    marketMode: mode,
    timeframe,
    strategyName: strategy.name || null,
    strategyDirection: strategy.direction || null,
    detectedPatterns: detectedPatterns.map((p)=>p.displayName),
    patternFamily: detectedPatterns.map((p)=>p.family),
    expectedDirection: detectedPatterns.map((p)=>p.expectedDirection),
    candleCount: detectedPatterns.map((p)=>p.candleCount),
    bullishScore: Number(bullishScore.toFixed(2)),
    bearishScore: Number(bearishScore.toFixed(2)),
    neutralScore: Number(neutralScore.toFixed(2)),
    dominantPatternDirection,
    patternConfidence,
    supportResistanceContext: context.supportResistanceContext || { support: isSupport(context), resistance: isResistance(context) },
    liquidityContext: context.liquidityContext || null,
    trendContext: context.trendContext || context.mtf || null,
    marketRegime: context.marketRegime || null,
    candleClosed: !hasOpenCandle,
    confirmationCandlePresent: !auditEvents.includes("confirmationCandleMissing"),
    conflicts,
    candlestickConfirmationScore: Number(raw.toFixed(2)),
    candlestickAdjustment,
    scoreBeforeAdjustment: rawStrategyScore,
    scoreAfterAdjustment: scoreAfterCandlestickAdjustment,
    finalDecision: conflicts.hardBlock ? "hard_block" : "score_adjustment"
  };
  return { detectedPatterns, bullishScore: audit.bullishScore, bearishScore: audit.bearishScore, neutralScore: audit.neutralScore, dominantPatternDirection, patternConfidence, confirmationQuality: audit.confirmationCandlePresent ? "closed_confirmed" : "missing_confirmation", conflicts, candlestickConfirmationScore: audit.candlestickConfirmationScore, candlestickAdjustment, rawStrategyScore, scoreAfterCandlestickAdjustment, blockerAnalytics: [...new Set(auditEvents)], audit };
}

function emitCandlestickPatternAudit(audit){ console.log(JSON.stringify(audit)); }

module.exports = { analyzeCandlestickPatterns, emitCandlestickPatternAudit, detectors };
