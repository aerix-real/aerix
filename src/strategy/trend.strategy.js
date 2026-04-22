function evaluateTrend(h1, m15, modeProfile) {
  const reasons = [];
  const blocks = [];

  const h1Bias = h1?.trend?.bias || "neutral";
  const m15Bias = m15?.trend?.bias || "neutral";

  const h1AdxState = h1?.adx?.state || "neutral";
  const m15AdxState = m15?.adx?.state || "neutral";

  const h1Bullish = h1Bias === "bullish";
  const h1Bearish = h1Bias === "bearish";
  const m15Bullish = m15Bias === "bullish";
  const m15Bearish = m15Bias === "bearish";

  const h1Strong =
    h1AdxState === "strong_bullish_trend" ||
    h1AdxState === "strong_bearish_trend";

  const m15Strong =
    m15AdxState === "strong_bullish_trend" ||
    m15AdxState === "strong_bearish_trend";

  let direction = "WAIT";
  let score = 0;

  if (h1Bullish && m15Bullish) {
    direction = "CALL";
    score += 35;
    reasons.push("H1 e M15 alinhados em tendência compradora.");
  } else if (h1Bearish && m15Bearish) {
    direction = "PUT";
    score += 35;
    reasons.push("H1 e M15 alinhados em tendência vendedora.");
  } else if (h1Bullish && !m15Bearish) {
    direction = "CALL";
    score += 18;
    reasons.push("H1 comprador com M15 sem conflito forte.");
  } else if (h1Bearish && !m15Bullish) {
    direction = "PUT";
    score += 18;
    reasons.push("H1 vendedor com M15 sem conflito forte.");
  } else {
    blocks.push("Sem alinhamento claro entre H1 e M15.");
  }

  if (direction === "CALL") {
    if (h1Strong) {
      score += 12;
      reasons.push("ADX do H1 confirma força compradora.");
    }
    if (m15Strong) {
      score += 8;
      reasons.push("ADX do M15 confirma continuação compradora.");
    }
  }

  if (direction === "PUT") {
    if (h1Strong) {
      score += 12;
      reasons.push("ADX do H1 confirma força vendedora.");
    }
    if (m15Strong) {
      score += 8;
      reasons.push("ADX do M15 confirma continuação vendedora.");
    }
  }

  if (modeProfile.blockers.requireStrongTrend) {
    if (
      direction === "CALL" &&
      !(h1AdxState === "strong_bullish_trend" || m15AdxState === "strong_bullish_trend")
    ) {
      blocks.push("Modo conservador exige tendência compradora mais forte.");
    }

    if (
      direction === "PUT" &&
      !(h1AdxState === "strong_bearish_trend" || m15AdxState === "strong_bearish_trend")
    ) {
      blocks.push("Modo conservador exige tendência vendedora mais forte.");
    }
  }

  return {
    direction,
    score,
    reasons,
    blocks
  };
}

module.exports = {
  evaluateTrend
};