const db = require("../config/database");

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function createStatsBucket() {
  return {
    total: 0,
    wins: 0,
    losses: 0,
    winrate: 0,
    lossrate: 0
  };
}

function updateBucket(bucket, result) {
  bucket.total += 1;

  if (result === "win") bucket.wins += 1;
  if (result === "loss") bucket.losses += 1;
}

function finalizeBucket(bucket) {
  bucket.winrate = bucket.total
    ? Math.round((bucket.wins / bucket.total) * 100)
    : 0;

  bucket.lossrate = bucket.total
    ? Math.round((bucket.losses / bucket.total) * 100)
    : 0;
}

async function insertSignal(data) {
  const query = `
    INSERT INTO public.signal_history
    (
      user_id,
      symbol,
      direction,
      signal,
      confidence,
      final_score,
      entry_quality,
      strategy_name,
      result,
      mode,
      trend_direction,
      trend_strength,
      volatility,
      entry_price,
      expires_at,
      blocked,
      block_reason,
      explanation,
      timing,
      entry_in_seconds,
      timing_mode,
      timing_confidence,
      market_regime,
      institutional_quality,
      adaptive_adjustment,
      tuning_weight
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
      $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
    )
    RETURNING *;
  `;

  const signal = data.signal || data.direction || "WAIT";

  const values = [
    data.user_id || 1,
    data.symbol || "UNKNOWN",
    data.direction || signal,
    signal,
    normalizeNumber(data.confidence, 0),
    normalizeNumber(data.final_score ?? data.finalScore, 0),
    data.entry_quality || data.entryQuality || "weak",
    data.strategy_name || data.strategyName || data.strategy || null,
    data.result || "pending",
    data.mode || "balanced",
    data.trend_direction || data.trendDirection || "neutral",
    normalizeNumber(data.trend_strength ?? data.trendStrength, 0),
    normalizeNumber(data.volatility, 0),
    data.entry_price ?? data.entryPrice ?? null,
    data.expires_at ?? data.expiry ?? data.expiration ?? null,
    data.blocked ?? false,
    data.block_reason ?? data.blockReason ?? null,
    data.explanation ?? null,
    data.timing ?? null,
    normalizeNumber(data.entry_in_seconds ?? data.entryInSeconds, 0),
    data.timing_mode ?? data.timingMode ?? null,
    data.timing_confidence ?? data.timingConfidence ?? null,
    data.market_regime ?? data.marketRegime ?? null,
    data.institutional_quality ?? data.institutionalQuality ?? null,
    normalizeNumber(data.adaptive_adjustment ?? data.adaptiveAdjustment, 0),
    normalizeNumber(data.tuning_weight ?? data.tuningWeight, 1)
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

async function save(data) {
  return insertSignal(data);
}

async function getLatest(limit = 20) {
  const result = await db.query(
    `
    SELECT *
    FROM public.signal_history
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function getStats() {
  const result = await db.query(`
    SELECT
      symbol,
      signal,
      strategy_name,
      result,
      created_at,
      volatility,
      final_score,
      entry_quality
    FROM public.signal_history
    WHERE result IN ('win', 'loss')
    ORDER BY created_at DESC
    LIMIT 1000
  `);

  const stats = {
    bySymbol: {},
    byHour: {},
    byStrategy: {},
    bySignal: {},
    bySymbolSignal: {},
    lossPatterns: {}
  };

  for (const row of result.rows) {
    const symbol = row.symbol || "unknown";
    const signal = row.signal || "WAIT";
    const strategy = row.strategy_name || "unknown";
    const hour = new Date(row.created_at).getHours();
    const resultType = String(row.result || "").toLowerCase();

    const volatility = normalizeNumber(row.volatility, 0);
    const finalScore = normalizeNumber(row.final_score, 0);
    const entryQuality = row.entry_quality || "unknown";

    const symbolSignalKey = `${symbol}:${signal}`;
    const lossPatternKey = `${symbol}:${signal}:${strategy}:${hour}`;

    if (!stats.bySymbol[symbol]) stats.bySymbol[symbol] = createStatsBucket();
    if (!stats.byHour[hour]) stats.byHour[hour] = createStatsBucket();
    if (!stats.byStrategy[strategy]) stats.byStrategy[strategy] = createStatsBucket();
    if (!stats.bySignal[signal]) stats.bySignal[signal] = createStatsBucket();

    if (!stats.bySymbolSignal[symbolSignalKey]) {
      stats.bySymbolSignal[symbolSignalKey] = createStatsBucket();
    }

    updateBucket(stats.bySymbol[symbol], resultType);
    updateBucket(stats.byHour[hour], resultType);
    updateBucket(stats.byStrategy[strategy], resultType);
    updateBucket(stats.bySignal[signal], resultType);
    updateBucket(stats.bySymbolSignal[symbolSignalKey], resultType);

    if (!stats.lossPatterns[lossPatternKey]) {
      stats.lossPatterns[lossPatternKey] = {
        ...createStatsBucket(),
        symbol,
        signal,
        strategy,
        hour,
        avgVolatility: 0,
        avgFinalScore: 0,
        entryQuality
      };
    }

    const pattern = stats.lossPatterns[lossPatternKey];

    updateBucket(pattern, resultType);
    pattern.avgVolatility += volatility;
    pattern.avgFinalScore += finalScore;
  }

  const finalizeGroup = (group) => {
    for (const key of Object.keys(group)) {
      const bucket = group[key];

      finalizeBucket(bucket);

      if (bucket.avgVolatility !== undefined) {
        bucket.avgVolatility = bucket.total
          ? Number((bucket.avgVolatility / bucket.total).toFixed(4))
          : 0;
      }

      if (bucket.avgFinalScore !== undefined) {
        bucket.avgFinalScore = bucket.total
          ? Number((bucket.avgFinalScore / bucket.total).toFixed(2))
          : 0;
      }
    }
  };

  finalizeGroup(stats.bySymbol);
  finalizeGroup(stats.byHour);
  finalizeGroup(stats.byStrategy);
  finalizeGroup(stats.bySignal);
  finalizeGroup(stats.bySymbolSignal);
  finalizeGroup(stats.lossPatterns);

  return stats;
}

async function getPerformanceBySymbol(symbol) {
  const result = await db.query(
    `
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE result = 'win')::int as wins,
      COUNT(*) FILTER (WHERE result = 'loss')::int as losses,
      COALESCE(AVG(final_score), 0)::numeric(10,2) as avg_final_score
    FROM public.signal_history
    WHERE symbol = $1
    `,
    [symbol]
  );

  return result.rows[0];
}

async function getPerformanceByHour() {
  const result = await db.query(`
    SELECT
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE result = 'win')::int as wins,
      COUNT(*) FILTER (WHERE result = 'loss')::int as losses,
      COALESCE(AVG(final_score), 0)::numeric(10,2) as avg_final_score
    FROM public.signal_history
    GROUP BY hour
    ORDER BY hour
  `);

  return result.rows;
}

async function updateSignalResult(id, result) {
  const response = await db.query(
    `
    UPDATE public.signal_history
    SET result = $1, checked_at = NOW()
    WHERE id = $2
    RETURNING *
    `,
    [result, id]
  );

  return response.rows[0] || null;
}

async function getExpiredPendingSignals(limit = 50) {
  const result = await db.query(
    `
    SELECT *
    FROM public.signal_history
    WHERE result = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    ORDER BY expires_at ASC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function finalizeSignalResult(id, { result, resultPrice }) {
  const response = await db.query(
    `
    UPDATE public.signal_history
    SET
      result = $1,
      result_price = $2,
      checked_at = NOW()
    WHERE id = $3
    RETURNING *
    `,
    [result, resultPrice, id]
  );

  return response.rows[0] || null;
}

async function getTopSymbols(limit = 8) {
  const result = await db.query(
    `
    SELECT
      symbol,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE result = 'win')::int as wins,
      COUNT(*) FILTER (WHERE result = 'loss')::int as losses,
      COALESCE(AVG(confidence), 0)::numeric(10,2) as avg_confidence,
      COALESCE(AVG(final_score), 0)::numeric(10,2) as avg_final_score
    FROM public.signal_history
    GROUP BY symbol
    HAVING COUNT(*) >= 1
    ORDER BY
      COUNT(*) FILTER (WHERE result = 'win') DESC,
      AVG(final_score) DESC NULLS LAST,
      COUNT(*) DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function getHourlyPerformance(limit = 24) {
  const result = await db.query(
    `
    SELECT
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE result = 'win')::int as wins,
      COUNT(*) FILTER (WHERE result = 'loss')::int as losses,
      COALESCE(AVG(final_score), 0)::numeric(10,2) as avg_final_score
    FROM public.signal_history
    GROUP BY hour
    ORDER BY hour
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function getDirectionalPerformance() {
  const result = await db.query(`
    SELECT
      signal,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE result = 'win')::int as wins,
      COUNT(*) FILTER (WHERE result = 'loss')::int as losses,
      COALESCE(AVG(final_score), 0)::numeric(10,2) as avg_final_score
    FROM public.signal_history
    WHERE signal IN ('CALL', 'PUT')
    GROUP BY signal
    ORDER BY signal
  `);

  return result.rows;
}

module.exports = {
  insertSignal,
  save,
  getLatest,
  getStats,
  getPerformanceBySymbol,
  getPerformanceByHour,
  updateSignalResult,
  getExpiredPendingSignals,
  finalizeSignalResult,
  getTopSymbols,
  getHourlyPerformance,
  getDirectionalPerformance
};