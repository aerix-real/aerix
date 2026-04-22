const {
  clamp,
  round,
  classifyEntryQuality,
  getModeProfile
} = require("./base.strategy");
const { evaluateTrend } = require("./trend.strategy");
const { evaluateEntry } = require("./entry.strategy");

function uniqueList(items = [], limit = 8) {
  return [...new Set(items.filter(Boolean))].slice(0, limit);
}

function buildFinalSignal(h1, m15, m5, mode = "balanced") {
  const modeProfile = getModeProfile(mode);

  const trendPart = evaluateTrend(h1, m15, modeProfile);
  const entryPart = evaluateEntry(trendPart.direction, m5, modeProfile);

  let direction = trendPart.direction;
  let confidence = 0;

  if (direction === "WAIT") {
    return {
      signal: "WAIT",
      confidence: 0,
      entryQuality: "weak",
      reasons: uniqueList([...trendPart.reasons, ...entryPart.reasons]),
      blocks: uniqueList([...trendPart.blocks, ...entryPart.blocks], 10),
      breakdown: {
        trendScore: trendPart.score,
        entryScore: entryPart.score
      }
    };
  }

  confidence =
    trendPart.score * modeProfile.trendWeight +
    entryPart.score * modeProfile.timingWeight;

  const totalBlocks = [...trendPart.blocks, ...entryPart.blocks];
  if (totalBlocks.length) {
    confidence -= totalBlocks.length * 8;
  }

  confidence = clamp(round(confidence, 2), 0, 99);

  if (confidence < modeProfile.minConfidence) {
    direction = "WAIT";
    totalBlocks.push(`Confiança abaixo do mínimo do modo ${mode}.`);
  }

  return {
    signal: direction,
    confidence,
    entryQuality: classifyEntryQuality(confidence),
    reasons: uniqueList([...trendPart.reasons, ...entryPart.reasons], 10),
    blocks: uniqueList(totalBlocks, 10),
    breakdown: {
      trendScore: round(trendPart.score),
      entryScore: round(entryPart.score)
    }
  };
}

module.exports = {
  buildFinalSignal
};