const MARKET_STRUCTURE_MODES = {
  conservative: {
    pivotLeft: 3,
    pivotRight: 3,
    minimumSwingDistanceAtr: 0.8,
    bosBufferAtr: 0.2,
    equalLevelToleranceAtr: 0.18,
    retestZoneAtr: 0.25,
    minimumDisplacementAtr: 0.35,
    maxScoreAdjustment: 6
  },
  balanced: {
    pivotLeft: 2,
    pivotRight: 2,
    minimumSwingDistanceAtr: 0.6,
    bosBufferAtr: 0.12,
    equalLevelToleranceAtr: 0.15,
    retestZoneAtr: 0.22,
    minimumDisplacementAtr: 0.3,
    maxScoreAdjustment: 8
  },
  aggressive: {
    pivotLeft: 2,
    pivotRight: 1,
    minimumSwingDistanceAtr: 0.4,
    bosBufferAtr: 0.08,
    equalLevelToleranceAtr: 0.12,
    retestZoneAtr: 0.2,
    minimumDisplacementAtr: 0.25,
    maxScoreAdjustment: 8
  }
};

const STRUCTURAL_TRENDS = Object.freeze({
  BULLISH: "BULLISH",
  BEARISH: "BEARISH",
  RANGE: "RANGE",
  TRANSITION: "TRANSITION",
  UNDEFINED: "UNDEFINED"
});

const OPERATIONAL_CONTEXTS = Object.freeze({
  TREND_CONTINUATION: "TREND_CONTINUATION",
  PULLBACK: "PULLBACK",
  FIRST_RETEST: "FIRST_RETEST",
  BREAKOUT: "BREAKOUT",
  LIQUIDITY_SWEEP: "LIQUIDITY_SWEEP",
  REVERSAL_TRANSITION: "REVERSAL_TRANSITION",
  RANGE: "RANGE",
  NO_CLEAR_STRUCTURE: "NO_CLEAR_STRUCTURE"
});

function normalizeMarketStructureMode(mode = "balanced") {
  const normalized = String(mode || "balanced").toLowerCase();
  if (["conservador", "conservative"].includes(normalized)) return "conservative";
  if (["agressivo", "aggressive"].includes(normalized)) return "aggressive";
  return "balanced";
}

function getMarketStructureConfig(mode = "balanced") {
  return MARKET_STRUCTURE_MODES[normalizeMarketStructureMode(mode)];
}

module.exports = {
  MARKET_STRUCTURE_MODES,
  STRUCTURAL_TRENDS,
  OPERATIONAL_CONTEXTS,
  normalizeMarketStructureMode,
  getMarketStructureConfig
};
