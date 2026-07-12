const FAMILIES = Object.freeze({
  BULLISH_REVERSAL: "bullish_reversal",
  BEARISH_REVERSAL: "bearish_reversal",
  BULLISH_CONTINUATION: "bullish_continuation",
  BEARISH_CONTINUATION: "bearish_continuation",
  INDECISION: "indecision",
  EXHAUSTION: "exhaustion",
  REJECTION: "rejection",
  INSTITUTIONAL_CONTEXT: "institutional_context"
});

const DIRECTION = Object.freeze({ CALL: "CALL", PUT: "PUT", NEUTRAL: "NEUTRAL" });

function pattern(name, displayName, family, expectedDirection, candleCount, baseWeight, options = {}) {
  return {
    name,
    displayName,
    family,
    expectedDirection,
    candleCount,
    enabled: options.enabled !== false,
    baseWeight,
    confirmationRequired: Boolean(options.confirmationRequired),
    preferredContexts: options.preferredContexts || [],
    forbiddenContexts: options.forbiddenContexts || [],
    handler: options.handler || name
  };
}

const candlestickPatternRegistry = [
  pattern("hammer", "Hammer", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 1, 12, { preferredContexts: ["support", "liquidity_sweep", "bearish_exhaustion"] }),
  pattern("invertedHammer", "Inverted Hammer", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 1, 9, { confirmationRequired: true }),
  pattern("hangingMan", "Hanging Man", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 1, 10, { preferredContexts: ["resistance", "uptrend"] }),
  pattern("shootingStar", "Shooting Star", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 1, 12, { preferredContexts: ["resistance", "liquidity_sweep"] }),
  pattern("bullishPinBar", "Bullish Pin Bar", FAMILIES.REJECTION, DIRECTION.CALL, 1, 11),
  pattern("bearishPinBar", "Bearish Pin Bar", FAMILIES.REJECTION, DIRECTION.PUT, 1, 11),
  pattern("bullishMarubozu", "Bullish Marubozu", FAMILIES.BULLISH_CONTINUATION, DIRECTION.CALL, 1, 9),
  pattern("bearishMarubozu", "Bearish Marubozu", FAMILIES.BEARISH_CONTINUATION, DIRECTION.PUT, 1, 9),
  pattern("doji", "Doji", FAMILIES.INDECISION, DIRECTION.NEUTRAL, 1, 6),
  pattern("spinningTop", "Spinning Top", FAMILIES.INDECISION, DIRECTION.NEUTRAL, 1, 5),
  pattern("bullishEngulfing", "Bullish Engulfing", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 2, 16),
  pattern("bearishEngulfing", "Bearish Engulfing", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 2, 16),
  pattern("bullishHarami", "Bullish Harami", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 2, 9, { confirmationRequired: true }),
  pattern("bearishHarami", "Bearish Harami", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 2, 9, { confirmationRequired: true }),
  pattern("piercingLine", "Piercing Line", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 2, 12),
  pattern("darkCloudCover", "Dark Cloud Cover", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 2, 12),
  pattern("tweezerBottom", "Tweezer Bottom", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 2, 10, { confirmationRequired: true }),
  pattern("tweezerTop", "Tweezer Top", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 2, 10),
  pattern("bullishOutsideBar", "Bullish Outside Bar", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 2, 12),
  pattern("bearishOutsideBar", "Bearish Outside Bar", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 2, 12),
  pattern("bullishInsideBarBreak", "Bullish Inside Bar Break", FAMILIES.BULLISH_CONTINUATION, DIRECTION.CALL, 3, 12, { confirmationRequired: true }),
  pattern("bearishInsideBarBreak", "Bearish Inside Bar Break", FAMILIES.BEARISH_CONTINUATION, DIRECTION.PUT, 3, 12, { confirmationRequired: true }),
  pattern("morningStar", "Morning Star", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 3, 18),
  pattern("eveningStar", "Evening Star", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 3, 18),
  pattern("morningDojiStar", "Morning Doji Star", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 3, 19),
  pattern("eveningDojiStar", "Evening Doji Star", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 3, 19),
  pattern("threeWhiteSoldiers", "Three White Soldiers", FAMILIES.BULLISH_CONTINUATION, DIRECTION.CALL, 3, 18),
  pattern("threeBlackCrows", "Three Black Crows", FAMILIES.BEARISH_CONTINUATION, DIRECTION.PUT, 3, 18),
  pattern("threeInsideUp", "Three Inside Up", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 3, 14),
  pattern("threeInsideDown", "Three Inside Down", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 3, 14),
  pattern("threeOutsideUp", "Three Outside Up", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 3, 15),
  pattern("threeOutsideDown", "Three Outside Down", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 3, 15),
  pattern("bullishAbandonedBaby", "Bullish Abandoned Baby", FAMILIES.BULLISH_REVERSAL, DIRECTION.CALL, 3, 16),
  pattern("bearishAbandonedBaby", "Bearish Abandoned Baby", FAMILIES.BEARISH_REVERSAL, DIRECTION.PUT, 3, 16),
  pattern("risingThreeMethods", "Rising Three Methods", FAMILIES.BULLISH_CONTINUATION, DIRECTION.CALL, 5, 18),
  pattern("fallingThreeMethods", "Falling Three Methods", FAMILIES.BEARISH_CONTINUATION, DIRECTION.PUT, 5, 18),
  pattern("bullishFlagCandleSequence", "Bullish Flag Candle Sequence", FAMILIES.BULLISH_CONTINUATION, DIRECTION.CALL, 5, 14),
  pattern("bearishFlagCandleSequence", "Bearish Flag Candle Sequence", FAMILIES.BEARISH_CONTINUATION, DIRECTION.PUT, 5, 14),
  pattern("bullishConsolidationBreak", "Bullish Consolidation Break", FAMILIES.BULLISH_CONTINUATION, DIRECTION.CALL, 5, 13),
  pattern("bearishConsolidationBreak", "Bearish Consolidation Break", FAMILIES.BEARISH_CONTINUATION, DIRECTION.PUT, 5, 13),
  pattern("firstRetestBullishConfirmation", "First Retest Bullish Confirmation", FAMILIES.INSTITUTIONAL_CONTEXT, DIRECTION.CALL, 2, 16),
  pattern("firstRetestBearishConfirmation", "First Retest Bearish Confirmation", FAMILIES.INSTITUTIONAL_CONTEXT, DIRECTION.PUT, 2, 16)
];

module.exports = { candlestickPatternRegistry, FAMILIES, DIRECTION };
