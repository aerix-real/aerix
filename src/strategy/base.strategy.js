function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function classifyEntryQuality(confidence) {
  if (confidence >= 90) return "institutional";
  if (confidence >= 82) return "high";
  if (confidence >= 72) return "good";
  if (confidence >= 60) return "moderate";
  return "weak";
}

function getModeProfile(mode = "balanced") {
  const profiles = {
    conservative: {
      minConfidence: 82,
      trendWeight: 1.2,
      timingWeight: 0.8,
      momentumWeight: 1.0,
      blockers: {
        requireStrongTrend: true,
        forbidCounterTrend: true,
        forbidLowVolatility: true,
        forbidNearResistanceCall: true,
        forbidNearSupportPut: true
      }
    },
    balanced: {
      minConfidence: 72,
      trendWeight: 1.0,
      timingWeight: 1.0,
      momentumWeight: 1.0,
      blockers: {
        requireStrongTrend: false,
        forbidCounterTrend: true,
        forbidLowVolatility: true,
        forbidNearResistanceCall: true,
        forbidNearSupportPut: true
      }
    },
    aggressive: {
      minConfidence: 64,
      trendWeight: 0.9,
      timingWeight: 1.2,
      momentumWeight: 1.15,
      blockers: {
        requireStrongTrend: false,
        forbidCounterTrend: false,
        forbidLowVolatility: false,
        forbidNearResistanceCall: false,
        forbidNearSupportPut: false
      }
    }
  };

  return profiles[mode] || profiles.balanced;
}

module.exports = {
  clamp,
  round,
  classifyEntryQuality,
  getModeProfile
};