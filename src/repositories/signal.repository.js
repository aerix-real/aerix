const db = require("../config/database");

const MINIMUM_SCORE_SQL = `
  COALESCE(
    NULLIF(minimum_score, 0),
    CASE
      WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 86
      WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 60
      ELSE 68
    END
  )
`;

const CONFIRMED_OPERATIONAL_WHERE = `
  COALESCE(blocked, false) = false
  AND COALESCE(execution_allowed, false) = true
  AND signal IN ('CALL', 'PUT')
  AND COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, 0) >= ${MINIMUM_SCORE_SQL}
`;

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

function createEmptyStats() {
  return {
    bySymbol: {},
    byHour: {},
    byStrategy: {},
    bySignal: {},
    bySymbolSignal: {},
    byMarketRegime: {},
    lossPatterns: {},
    global: createStatsBucket()
  };
}

function isSchemaMismatchError(error) {
  return error?.code === "42703" || /column .* does not exist/i.test(String(error?.message || ""));
}

function logStructuredRepositoryError(event, error, context = {}) {
  console.error(JSON.stringify({
    scope: "aerix_signal_repository",
    event,
    timestamp: new Date().toISOString(),
    errorCode: error?.code || null,
    errorMessage: error?.message || String(error),
    ...context
  }));
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
      tuning_weight,
      execution_allowed,
      minimum_score,
      adjusted_score
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
      $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
    )
    RETURNING *;
  `;

  const signal = data.signal || data.direction || "WAIT";

  const values = [
    data.user_id ?? null,
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
    normalizeNumber(data.tuning_weight ?? data.tuningWeight, 1),
    data.execution_allowed ?? data.executionAllowed ?? false,
    normalizeNumber(data.minimum_score ?? data.minimumScore, 0),
    normalizeNumber(data.adjusted_score ?? data.adjustedScore ?? data.final_score ?? data.finalScore, 0)
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

async function getLatestConfirmed(limit = 20) {
  const result = await db.query(
    `
    SELECT
      *,
      execution_allowed AS "executionAllowed",
      minimum_score AS "minimumScore",
      adjusted_score AS "adjustedScore"
    FROM public.signal_history
    WHERE ${CONFIRMED_OPERATIONAL_WHERE}
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function getStats() {
  try {
    const result = await db.query(`
    SELECT
      symbol,
      signal,
      strategy_name,
      result,
      created_at,
      volatility,
      final_score,
      entry_quality,
      market_regime
    FROM public.signal_history
    WHERE result IN ('win', 'loss')
      AND ${CONFIRMED_OPERATIONAL_WHERE}
    ORDER BY created_at DESC
    LIMIT 1000
  `);

  const stats = {
    bySymbol: {},
    byHour: {},
    byStrategy: {},
    bySignal: {},
    bySymbolSignal: {},
    byMarketRegime: {},
    lossPatterns: {},
    global: createStatsBucket()
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
    const marketRegime = row.market_regime || "NORMAL";

    const symbolSignalKey = `${symbol}:${signal}`;
    const lossPatternKey = `${symbol}:${signal}:${strategy}:${hour}`;

    if (!stats.bySymbol[symbol]) stats.bySymbol[symbol] = createStatsBucket();
    if (!stats.byHour[hour]) stats.byHour[hour] = createStatsBucket();
    if (!stats.byStrategy[strategy]) stats.byStrategy[strategy] = createStatsBucket();
    if (!stats.bySignal[signal]) stats.bySignal[signal] = createStatsBucket();
    if (!stats.byMarketRegime[marketRegime]) stats.byMarketRegime[marketRegime] = createStatsBucket();

    if (!stats.bySymbolSignal[symbolSignalKey]) {
      stats.bySymbolSignal[symbolSignalKey] = createStatsBucket();
    }

    updateBucket(stats.bySymbol[symbol], resultType);
    updateBucket(stats.byHour[hour], resultType);
    updateBucket(stats.byStrategy[strategy], resultType);
    updateBucket(stats.bySignal[signal], resultType);
    updateBucket(stats.bySymbolSignal[symbolSignalKey], resultType);
    updateBucket(stats.byMarketRegime[marketRegime], resultType);
    updateBucket(stats.global, resultType);

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
  finalizeGroup(stats.byMarketRegime);
  finalizeGroup(stats.lossPatterns);
  finalizeBucket(stats.global);

    return stats;
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      logStructuredRepositoryError("stats_schema_mismatch", error, {
        table: "signal_history",
        fallback: "empty_stats"
      });

      return createEmptyStats();
    }

    throw error;
  }
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
      AND ${CONFIRMED_OPERATIONAL_WHERE}
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
    WHERE ${CONFIRMED_OPERATIONAL_WHERE}
    GROUP BY hour
    ORDER BY hour
  `);

  return result.rows;
}

function calculateRate(part, total) {
  const numerator = Number(part || 0);
  const denominator = Number(total || 0);
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function mapWinrateRow(row = {}, keyField = null) {
  const total = Number(row.total || 0);
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  const payload = {
    total,
    wins,
    losses,
    winrate: calculateRate(wins, wins + losses)
  };

  if (keyField) payload[keyField] = row[keyField];
  return payload;
}

function mapApprovedSignal(row = null) {
  if (!row) return null;

  return {
    id: row.id,
    symbol: row.symbol,
    signal: row.signal || row.direction,
    direction: row.direction || row.signal,
    strategyName: row.strategy_name,
    score: normalizeNumber(row.adjusted_score || row.final_score || row.confidence, 0),
    confidence: normalizeNumber(row.confidence, 0),
    finalScore: normalizeNumber(row.final_score, 0),
    entryPrice: row.entry_price === null || row.entry_price === undefined ? null : Number(row.entry_price),
    resultPrice: row.result_price === null || row.result_price === undefined ? null : Number(row.result_price),
    result: row.result,
    marketRegime: row.market_regime,
    executionAllowed: row.execution_allowed,
    blockReason: row.block_reason,
    createdAt: row.created_at,
    checkedAt: row.checked_at
  };
}

function createEmptyOperationalOverview() {
  const emptyWinrate = mapWinrateRow({});

  return {
    analyzedToday: 0,
    signalsToday: 0,
    approvedToday: 0,
    approvedSignalsToday: 0,
    blockedToday: 0,
    blockedSignalsToday: 0,
    approvalRate: 0,
    winrate24h: emptyWinrate,
    winrate7d: emptyWinrate,
    winrate30d: emptyWinrate,
    winrateBySymbol: [],
    winrateByStrategy: [],
    topBlockReason: null,
    lastApprovedSignal: null,
    generatedAt: new Date().toISOString()
  };
}

async function getOperationalOverview() {
  try {
    const [todayResult, outcome24hResult, outcome7dResult, outcome30dResult, bySymbolResult, byStrategyResult, blockReasonResult, lastApprovedResult] = await Promise.all([
    db.query(`
      SELECT
        GREATEST(
          COALESCE((
            SELECT COUNT(*)::int
            FROM public.audit_logs
            WHERE created_at >= CURRENT_DATE
              AND event_type IN (
                'signal_generated',
                'signal_blocked',
                'signal_discarded_unconfirmed',
                'predictive_ai_pre_block',
                'symbol_cycle_error'
              )
          ), 0),
          COALESCE((
            SELECT COUNT(*)::int
            FROM public.signal_history
            WHERE created_at >= CURRENT_DATE
          ), 0)
        )::int AS analyzed,
        GREATEST(
          COALESCE((
            SELECT COUNT(*)::int
            FROM public.audit_logs
            WHERE created_at >= CURRENT_DATE
              AND event_type = 'signal_generated'
          ), 0),
          COALESCE((
            SELECT COUNT(*)::int
            FROM public.signal_history
            WHERE created_at >= CURRENT_DATE
              AND ${CONFIRMED_OPERATIONAL_WHERE}
          ), 0)
        )::int AS approved,
        GREATEST(
          COALESCE((
            SELECT COUNT(*)::int
            FROM public.audit_logs
            WHERE created_at >= CURRENT_DATE
              AND event_type IN (
                'signal_blocked',
                'signal_discarded_unconfirmed',
                'predictive_ai_pre_block',
                'symbol_cycle_error'
              )
          ), 0),
          COALESCE((
            SELECT COUNT(*)::int
            FROM public.signal_history
            WHERE created_at >= CURRENT_DATE
              AND NOT (${CONFIRMED_OPERATIONAL_WHERE})
          ), 0)
        )::int AS blocked
    `),

    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE result IN ('win', 'loss'))::int AS total,
        COUNT(*) FILTER (WHERE result = 'win')::int AS wins,
        COUNT(*) FILTER (WHERE result = 'loss')::int AS losses
      FROM public.signal_history
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND ${CONFIRMED_OPERATIONAL_WHERE}
    `),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE result IN ('win', 'loss'))::int AS total,
        COUNT(*) FILTER (WHERE result = 'win')::int AS wins,
        COUNT(*) FILTER (WHERE result = 'loss')::int AS losses
      FROM public.signal_history
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND ${CONFIRMED_OPERATIONAL_WHERE}
    `),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE result IN ('win', 'loss'))::int AS total,
        COUNT(*) FILTER (WHERE result = 'win')::int AS wins,
        COUNT(*) FILTER (WHERE result = 'loss')::int AS losses
      FROM public.signal_history
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND ${CONFIRMED_OPERATIONAL_WHERE}
    `),
    db.query(`
      SELECT
        symbol,
        COUNT(*) FILTER (WHERE result IN ('win', 'loss'))::int AS total,
        COUNT(*) FILTER (WHERE result = 'win')::int AS wins,
        COUNT(*) FILTER (WHERE result = 'loss')::int AS losses
      FROM public.signal_history
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND ${CONFIRMED_OPERATIONAL_WHERE}
      GROUP BY symbol
      ORDER BY total DESC, wins DESC, symbol ASC
    `),
    db.query(`
      SELECT
        COALESCE(strategy_name, 'unknown') AS strategy_name,
        COUNT(*) FILTER (WHERE result IN ('win', 'loss'))::int AS total,
        COUNT(*) FILTER (WHERE result = 'win')::int AS wins,
        COUNT(*) FILTER (WHERE result = 'loss')::int AS losses
      FROM public.signal_history
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND ${CONFIRMED_OPERATIONAL_WHERE}
      GROUP BY COALESCE(strategy_name, 'unknown')
      ORDER BY total DESC, wins DESC, strategy_name ASC
    `),
    db.query(`
      SELECT reason, COUNT(*)::int AS total
      FROM (
        SELECT COALESCE(
          NULLIF(meta->>'blockReason', ''),
          NULLIF(meta->>'block_reason', ''),
          NULLIF(meta #>> '{execution,reason}', ''),
          NULLIF(meta->>'error', ''),
          event_type
        ) AS reason
        FROM public.audit_logs
        WHERE created_at >= CURRENT_DATE
          AND event_type IN (
            'signal_blocked',
            'signal_discarded_unconfirmed',
            'predictive_ai_pre_block',
            'symbol_cycle_error'
          )
        UNION ALL
        SELECT COALESCE(NULLIF(block_reason, ''), 'Sinal bloqueado sem motivo explícito.') AS reason
        FROM public.signal_history
        WHERE created_at >= CURRENT_DATE
          AND NOT (${CONFIRMED_OPERATIONAL_WHERE})
      ) reasons
      GROUP BY reason
      ORDER BY total DESC, reason ASC
      LIMIT 1
    `),
    db.query(`
      SELECT *
      FROM public.signal_history
      WHERE ${CONFIRMED_OPERATIONAL_WHERE}
      ORDER BY created_at DESC
      LIMIT 1
    `)
  ]);

  const today = todayResult.rows[0] || { analyzed: 0, approved: 0, blocked: 0 };
  const analyzedToday = Number(today.analyzed || 0);
  const approvedToday = Number(today.approved || 0);
  const blockedToday = Number(today.blocked || 0);

  return {
    analyzedToday,
    signalsToday: analyzedToday,
    approvedToday,
    approvedSignalsToday: approvedToday,
    blockedToday,
    blockedSignalsToday: blockedToday,
    approvalRate: calculateRate(approvedToday, analyzedToday),
    winrate24h: mapWinrateRow(outcome24hResult.rows[0] || {}),
    winrate7d: mapWinrateRow(outcome7dResult.rows[0] || {}),
    winrate30d: mapWinrateRow(outcome30dResult.rows[0] || {}),
    winrateBySymbol: bySymbolResult.rows.map((row) => mapWinrateRow(row, "symbol")),
    winrateByStrategy: byStrategyResult.rows.map((row) => ({
      strategyName: row.strategy_name,
      ...mapWinrateRow(row)
    })),
    topBlockReason: blockReasonResult.rows[0]
      ? {
          reason: blockReasonResult.rows[0].reason,
          total: Number(blockReasonResult.rows[0].total || 0)
        }
      : null,
    lastApprovedSignal: mapApprovedSignal(lastApprovedResult.rows[0] || null),
    generatedAt: new Date().toISOString()
  };
  } catch (error) {
    if (isSchemaMismatchError(error) || error?.code === "42P01") {
      logStructuredRepositoryError("operational_overview_schema_mismatch", error, {
        fallback: "empty_operational_overview"
      });

      return createEmptyOperationalOverview();
    }

    throw error;
  }
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
    WHERE ${CONFIRMED_OPERATIONAL_WHERE}
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
    WHERE ${CONFIRMED_OPERATIONAL_WHERE}
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
    WHERE ${CONFIRMED_OPERATIONAL_WHERE}
    GROUP BY signal
    ORDER BY signal
  `);

  return result.rows;
}

module.exports = {
  insertSignal,
  save,
  getLatest,
  getLatestConfirmed,
  getStats,
  getPerformanceBySymbol,
  getPerformanceByHour,
  getOperationalOverview,
  updateSignalResult,
  getExpiredPendingSignals,
  finalizeSignalResult,
  getTopSymbols,
  getHourlyPerformance,
  getDirectionalPerformance
};