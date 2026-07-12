const MARKET_STRUCTURE_CONFIG = {
  pivotWindow: 2,
  swingLookback: 80,
  minSwingDistancePercent: 0.03,
  equalLevelTolerancePercent: 0.05,
  retestTolerancePercent: 0.08,
  sweepLookback: 20,
  firstRetestLookback: 12,
  timeframes: ["h1", "m15", "m5"],
  timeframeWeights: {
    h1: 0.45,
    m15: 0.35,
    m5: 0.2
  },
  score: {
    alignedTrend: 8,
    structurePreserved: 5,
    bos: 7,
    mss: 6,
    firstRetest: 5,
    liquiditySweepWithDirection: 4,
    oppositeStructurePenalty: 8,
    neutralPenalty: 2
  },
  adjustment: {
    maxBonus: 12,
    maxPenalty: -12
  }
};

module.exports = MARKET_STRUCTURE_CONFIG;
