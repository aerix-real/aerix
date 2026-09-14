const EPSILON = 1e-10;

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeCandles(candles = []) {
  return candles
    .filter((c) => c && ["open", "high", "low", "close"].every((key) => finiteNumber(c[key])))
    .map((c) => ({
      ...c,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    }));
}

function candle(c) {
  const range = Math.max(Math.abs(c.high - c.low), EPSILON);
  const body = Math.abs(c.close - c.open);
  const upper = Math.max(c.high - Math.max(c.open, c.close), 0);
  const lower = Math.max(Math.min(c.open, c.close) - c.low, 0);
  return {
    bullish: c.close > c.open,
    bearish: c.close < c.open,
    body,
    range,
    bodyPct: body / range,
    upper,
    lower,
    upperPct: upper / range,
    lowerPct: lower / range
  };
}

function bodyMid(c) {
  return (c.open + c.close) / 2;
}

function near(a, b, tolerance) {
  return Math.abs(a - b) <= Math.max(tolerance, EPSILON);
}

function gapUp(a, b) {
  return b.low > a.high;
}

function gapDown(a, b) {
  return b.high < a.low;
}

function sameColor(a, b) {
  return (a.close > a.open) === (b.close > b.open);
}

function trendBefore(candles, index, lookback = 3) {
  if (index < lookback) return "unknown";
  const first = candles[index - lookback].close;
  const last = candles[index - 1].close;
  const move = last - first;
  const threshold = Math.max(Math.abs(first) * 0.001, EPSILON);
  if (move > threshold) return "up";
  if (move < -threshold) return "down";
  return "sideways";
}

function addPattern(result, pattern, direction, index, strength, reason, candlesUsed = 1) {
  result.push({
    pattern,
    direction,
    index,
    candles: candlesUsed,
    strength: Math.max(1, Math.min(5, Math.round(strength))),
    reason
  });
}

function detectSingle(candles, i, result) {
  const c = candles[i];
  const m = candle(c);
  const trend = trendBefore(candles, i);
  const isDoji = m.bodyPct <= 0.1;
  const isSpinningTop = m.bodyPct <= 0.35 && m.upperPct >= 0.2 && m.lowerPct >= 0.2;
  const isMarubozu = m.bodyPct >= 0.9 && m.upperPct <= 0.05 && m.lowerPct <= 0.05;

  if (isDoji) addPattern(result, "Doji", "NEUTRAL", i, 2, "Abertura e fechamento muito próximos.");
  if (isSpinningTop) addPattern(result, "Spinning Top", "NEUTRAL", i, 2, "Corpo pequeno com sombras relevantes.");
  if (isMarubozu) addPattern(result, m.bullish ? "Bullish Marubozu" : "Bearish Marubozu", m.bullish ? "CALL" : "PUT", i, 4, "Corpo dominante com sombras mínimas.");

  if (isDoji && m.lowerPct >= 0.6 && m.upperPct <= 0.12) {
    addPattern(result, "Dragonfly Doji", "CALL", i, 4, "Doji com sombra inferior dominante.");
  }

  if (isDoji && m.upperPct >= 0.6 && m.lowerPct <= 0.12) {
    addPattern(result, "Gravestone Doji", "PUT", i, 4, "Doji com sombra superior dominante.");
  }

  const hammerShape = m.lower >= Math.max(m.body * 2, m.range * 0.45) && m.upper <= Math.max(m.body * 0.5, m.range * 0.1) && m.bodyPct <= 0.5;
  const invertedShape = m.upper >= Math.max(m.body * 2, m.range * 0.45) && m.lower <= Math.max(m.body * 0.5, m.range * 0.1) && m.bodyPct <= 0.5;

  if (hammerShape) {
    if (trend === "down") addPattern(result, "Hammer", "CALL", i, 4, "Longa sombra inferior após movimento de baixa.");
    if (trend === "up") addPattern(result, "Hanging Man", "PUT", i, 3, "Forma de martelo após movimento de alta.");
  }

  if (invertedShape) {
    if (trend === "down") addPattern(result, "Inverted Hammer", "CALL", i, 3, "Longa sombra superior após movimento de baixa.");
    if (trend === "up") addPattern(result, "Shooting Star", "PUT", i, 4, "Longa sombra superior após movimento de alta.");
  }

  if (m.bodyPct >= 0.8 && m.upperPct <= 0.1 && m.lowerPct <= 0.1) {
    if (m.bullish) addPattern(result, "Bullish Belt Hold", "CALL", i, 3, "Candle de alta com abertura próxima da mínima.");
    if (m.bearish) addPattern(result, "Bearish Belt Hold", "PUT", i, 3, "Candle de baixa com abertura próxima da máxima.");
  }
}

function detectTwo(candles, i, result) {
  if (i < 1) return;
  const a = candles[i - 1];
  const b = candles[i];
  const am = candle(a);
  const bm = candle(b);
  const tolerance = Math.max(a.range || 0, b.range || 0) * 0.12;
  const trend = trendBefore(candles, i, 4);

  if (am.bearish && bm.bullish && b.open <= a.close && b.close >= a.open) {
    addPattern(result, "Bullish Engulfing", "CALL", i, 5, "Candle de alta envolve o corpo da candle anterior.", 2);
  }
  if (am.bullish && bm.bearish && b.open >= a.close && b.close <= a.open) {
    addPattern(result, "Bearish Engulfing", "PUT", i, 5, "Candle de baixa envolve o corpo da candle anterior.", 2);
  }

  const aSmall = am.bodyPct <= 0.35;
  const bSmall = bm.bodyPct <= 0.35;
  if (am.bearish && bm.bullish && aSmall && bSmall && b.open > a.close && b.close < a.open) {
    addPattern(result, "Bullish Harami", "CALL", i, 3, "Corpo pequeno de alta contido no corpo anterior de baixa.", 2);
  }
  if (am.bullish && bm.bearish && aSmall && bSmall && b.open < a.close && b.close > a.open) {
    addPattern(result, "Bearish Harami", "PUT", i, 3, "Corpo pequeno de baixa contido no corpo anterior de alta.", 2);
  }

  if (am.bearish && bm.bullish && bm.bodyPct <= 0.15 && b.open > a.close && b.close < a.open) {
    addPattern(result, "Bullish Harami Cross", "CALL", i, 4, "Doji pequeno contido no corpo de baixa anterior.", 2);
  }
  if (am.bullish && bm.bearish && bm.bodyPct <= 0.15 && b.open < a.close && b.close > a.open) {
    addPattern(result, "Bearish Harami Cross", "PUT", i, 4, "Doji pequeno contido no corpo de alta anterior.", 2);
  }

  if (am.bearish && bm.bullish && b.open < a.low && b.close > bodyMid(a) && b.close < a.open) {
    addPattern(result, "Piercing Line", "CALL", i, 4, "Candle de alta recupera mais da metade do corpo de baixa anterior.", 2);
  }
  if (am.bullish && bm.bearish && b.open > a.high && b.close < bodyMid(a) && b.close > a.open) {
    addPattern(result, "Dark Cloud Cover", "PUT", i, 4, "Candle de baixa perde mais da metade do corpo de alta anterior.", 2);
  }

  if (near(a.low, b.low, tolerance) && am.bearish && bm.bullish) {
    addPattern(result, "Tweezer Bottom", "CALL", i, 3, "Mínimas aproximadamente iguais após pressão vendedora.", 2);
  }
  if (near(a.high, b.high, tolerance) && am.bullish && bm.bearish) {
    addPattern(result, "Tweezer Top", "PUT", i, 3, "Máximas aproximadamente iguais após pressão compradora.", 2);
  }

  if (am.bearish && bm.bullish && b.open > a.open && b.close > a.close && b.open >= a.close) {
    addPattern(result, "Bullish Kicker", "CALL", i, 4, "Mudança abrupta de direção entre candles.", 2);
  }
  if (am.bullish && bm.bearish && b.open < a.open && b.close < a.close && b.open <= a.close) {
    addPattern(result, "Bearish Kicker", "PUT", i, 4, "Mudança abrupta de direção entre candles.", 2);
  }

  if (am.bullish && bm.bearish && b.open === a.open) {
    addPattern(result, "Bearish Meeting Lines", "PUT", i, 2, "Aberturas coincidentes com fechamento em direção oposta.", 2);
  }
  if (am.bearish && bm.bullish && b.open === a.open) {
    addPattern(result, "Bullish Meeting Lines", "CALL", i, 2, "Aberturas coincidentes com fechamento em direção oposta.", 2);
  }

  if (am.bearish && bm.bullish && b.open === a.close && b.close > a.open) {
    addPattern(result, "Bullish Separating Lines", "CALL", i, 3, "Nova candle de alta parte do fechamento anterior e expande.", 2);
  }
  if (am.bullish && bm.bearish && b.open === a.close && b.close < a.open) {
    addPattern(result, "Bearish Separating Lines", "PUT", i, 3, "Nova candle de baixa parte do fechamento anterior e expande.", 2);
  }

  if (trend === "down" && gapUp(a, b) && bm.bullish) {
    addPattern(result, "Bullish Breakaway", "CALL", i, 3, "Gap de alta após movimento de baixa.", 2);
  }
  if (trend === "up" && gapDown(a, b) && bm.bearish) {
    addPattern(result, "Bearish Breakaway", "PUT", i, 3, "Gap de baixa após movimento de alta.", 2);
  }
}

function detectThree(candles, i, result) {
  if (i < 2) return;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  const am = candle(a);
  const bm = candle(b);
  const cm = candle(c);
  const trend = trendBefore(candles, i, 5);

  if (am.bearish && bm.bodyPct <= 0.3 && cm.bullish && c.close > bodyMid(a) && c.close > b.high) {
    addPattern(result, "Morning Star", "CALL", i, 5, "Baixa, indecisão e recuperação forte de alta.", 3);
  }
  if (am.bullish && bm.bodyPct <= 0.3 && cm.bearish && c.close < bodyMid(a) && c.close < b.low) {
    addPattern(result, "Evening Star", "PUT", i, 5, "Alta, indecisão e reversão forte de baixa.", 3);
  }

  if (am.bearish && bm.bodyPct <= 0.15 && cm.bullish && gapDown(a, b) && gapUp(b, c)) {
    addPattern(result, "Bullish Abandoned Baby", "CALL", i, 5, "Doji isolado entre dois gaps em contexto de baixa.", 3);
  }
  if (am.bullish && bm.bodyPct <= 0.15 && cm.bearish && gapUp(a, b) && gapDown(b, c)) {
    addPattern(result, "Bearish Abandoned Baby", "PUT", i, 5, "Doji isolado entre dois gaps em contexto de alta.", 3);
  }

  if (am.bearish && bm.bodyPct <= 0.15 && cm.bullish && cm.close > bodyMid(a)) {
    addPattern(result, "Morning Doji Star", "CALL", i, 5, "Doji central precede recuperação de alta.", 3);
  }
  if (am.bullish && bm.bodyPct <= 0.15 && cm.bearish && cm.close < bodyMid(a)) {
    addPattern(result, "Evening Doji Star", "PUT", i, 5, "Doji central precede reversão de baixa.", 3);
  }

  if (am.bullish && bm.bullish && cm.bullish && a.close < b.close && b.close < c.close && am.bodyPct > 0.45 && bm.bodyPct > 0.45 && cm.bodyPct > 0.45 && bm.open <= a.close && bm.close > a.close && cm.open <= b.close && cm.close > b.close) {
    addPattern(result, "Three White Soldiers", "CALL", i, 5, "Três candles de alta consecutivas com fechamentos crescentes.", 3);
  }
  if (am.bearish && bm.bearish && cm.bearish && a.close > b.close && b.close > c.close && am.bodyPct > 0.45 && bm.bodyPct > 0.45 && cm.bodyPct > 0.45 && bm.open >= a.close && bm.close < a.close && cm.open >= b.close && cm.close < b.close) {
    addPattern(result, "Three Black Crows", "PUT", i, 5, "Três candles de baixa consecutivas com fechamentos decrescentes.", 3);
  }

  if (am.bearish && bm.bullish && cm.bullish && b.high < a.high && b.low > a.low && c.close > a.high) {
    addPattern(result, "Three Inside Up", "CALL", i, 4, "Harami de alta seguido de rompimento para cima.", 3);
  }
  if (am.bullish && bm.bearish && cm.bearish && b.high < a.high && b.low > a.low && c.close < a.low) {
    addPattern(result, "Three Inside Down", "PUT", i, 4, "Harami de baixa seguido de rompimento para baixo.", 3);
  }

  if (am.bearish && bm.bullish && cm.bullish && b.open < a.close && b.close > a.open && c.close > b.high) {
    addPattern(result, "Three Outside Up", "CALL", i, 4, "Engolfo de alta seguido de continuação compradora.", 3);
  }
  if (am.bullish && bm.bearish && cm.bearish && b.open > a.close && b.close < a.open && c.close < b.low) {
    addPattern(result, "Three Outside Down", "PUT", i, 4, "Engolfo de baixa seguido de continuação vendedora.", 3);
  }

  if (trend === "up" && am.bullish && bm.bullish && cm.bullish && am.bodyPct > bm.bodyPct && bm.bodyPct > cm.bodyPct && cm.upperPct > 0.15) {
    addPattern(result, "Advance Block", "PUT", i, 3, "Alta continua, mas os corpos diminuem e a sombra superior aumenta.", 3);
  }
  if (trend === "up" && am.bullish && bm.bodyPct <= 0.35 && cm.bearish) {
    addPattern(result, "Deliberation", "PUT", i, 3, "Alta perde impulso e termina com candle de baixa.", 3);
  }
}

function detectContinuation(candles, i, result) {
  if (i < 4) return;
  const a = candles[i - 4];
  const b = candles[i - 3];
  const c = candles[i - 2];
  const d = candles[i - 1];
  const e = candles[i];
  const am = candle(a);
  const em = candle(e);

  if (am.bullish && em.bullish && [b, c, d].every((x) => x.close < a.close && x.low > a.low)) {
    addPattern(result, "Rising Three Methods", "CALL", i, 4, "Candle de alta dominante seguida de consolidação interna e retomada.", 5);
  }
  if (am.bearish && em.bearish && [b, c, d].every((x) => x.close > a.close && x.high < a.high)) {
    addPattern(result, "Falling Three Methods", "PUT", i, 4, "Candle de baixa dominante seguida de consolidação interna e retomada.", 5);
  }

  if (a.bullish && b.bullish && c.bearish && d.bullish && e.bullish && d.open < c.close && e.close > c.high) {
    addPattern(result, "Upside Tasuki Gap", "CALL", i, 3, "Gap de alta parcialmente corrigido e retomado.", 5);
  }
  if (a.bearish && b.bearish && c.bullish && d.bearish && e.bearish && d.open > c.close && e.close < c.low) {
    addPattern(result, "Downside Tasuki Gap", "PUT", i, 3, "Gap de baixa parcialmente corrigido e retomado.", 5);
  }
}

function detectCandlestickPatterns(candles = [], options = {}) {
  const normalized = normalizeCandles(candles);
  const result = [];
  const minBars = Number(options.minBars || 5);

  if (normalized.length < minBars) return [];

  for (let i = 0; i < normalized.length; i += 1) {
    detectSingle(normalized, i, result);
    detectTwo(normalized, i, result);
    detectThree(normalized, i, result);
    detectContinuation(normalized, i, result);
  }

  const latestIndex = normalized.length - 1;
  return result
    .filter((item) => item.index === latestIndex)
    .sort((a, b) => b.strength - a.strength || b.candles - a.candles);
}

function summarizePatterns(patterns = []) {
  const bullish = patterns.filter((p) => p.direction === "CALL");
  const bearish = patterns.filter((p) => p.direction === "PUT");
  const neutral = patterns.filter((p) => p.direction === "NEUTRAL");
  const bullishScore = bullish.reduce((sum, p) => sum + p.strength, 0);
  const bearishScore = bearish.reduce((sum, p) => sum + p.strength, 0);
  const total = bullishScore + bearishScore;

  let direction = "WAIT";
  if (total > 0) {
    const edge = Math.abs(bullishScore - bearishScore) / total;
    if (bullishScore > bearishScore && edge >= 0.25) direction = "CALL";
    if (bearishScore > bullishScore && edge >= 0.25) direction = "PUT";
  }

  return {
    direction,
    bullishScore,
    bearishScore,
    neutralCount: neutral.length,
    patternCount: patterns.length,
    confidence: total ? Math.round((Math.max(bullishScore, bearishScore) / total) * 100) : 0
  };
}

module.exports = {
  detectCandlestickPatterns,
  summarizePatterns,
  normalizeCandles
};
