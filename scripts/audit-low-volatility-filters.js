const db = require("../src/config/database");

const SCORE_SQL = "COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, score, 0)";
const NORMALIZED_MODE_SQL = `
  CASE
    WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 'conservative'
    WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 'aggressive'
    ELSE 'balanced'
  END
`;
const VERY_LOW_THRESHOLD_SQL = `
  CASE ${NORMALIZED_MODE_SQL}
    WHEN 'conservative' THEN 0.05
    WHEN 'aggressive' THEN 0.02
    ELSE 0.025
  END
`;
const LOW_VOLATILITY_REGIME_CONDITION = "UPPER(COALESCE(market_regime, '')) = 'LOW_VOLATILITY'";
const LOW_VOLATILITY_VALIDATION_CONDITION = "COALESCE(volatility, 0) > 0 AND COALESCE(volatility, 0) < 0.12";
const VERY_LOW_VOLATILITY_CONDITION = `COALESCE(volatility, 0) > 0 AND COALESCE(volatility, 0) < (${VERY_LOW_THRESHOLD_SQL})`;
const VOLATILITY_BLOCK_REASON_CONDITION = `
  (
    LOWER(COALESCE(block_reason, '')) LIKE '%volatil%'
    OR LOWER(COALESCE(block_reason, '')) LIKE '%volat%'
    OR LOWER(COALESCE(explanation, '')) LIKE '%volatil%'
    OR LOWER(COALESCE(explanation, '')) LIKE '%volat%'
  )
`;
const LOW_VOLATILITY_BLOCK_CONDITION = `
  (
    ${LOW_VOLATILITY_VALIDATION_CONDITION}
    OR ${LOW_VOLATILITY_REGIME_CONDITION}
    OR ${VOLATILITY_BLOCK_REASON_CONDITION}
  )
`;

function pct(part, total) {
  const numerator = Number(part || 0);
  const denominator = Number(total || 0);

  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function num(value, decimals = 6) {
  const parsed = Number(value || 0);

  return Number(parsed.toFixed(decimals));
}

function normalizeMode(mode) {
  const normalized = String(mode || "balanced").toLowerCase();
  if (["conservador", "conservative"].includes(normalized)) return "conservative";
  if (["agressivo", "aggressive"].includes(normalized)) return "aggressive";
  return "balanced";
}

function releaseThreshold(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "balanced") return 90;
  if (normalized === "aggressive") return 80;
  return null;
}

function thresholdSet(mode) {
  const normalized = normalizeMode(mode);
  const veryLow = normalized === "conservative" ? 0.05 : normalized === "aggressive" ? 0.02 : 0.025;

  return {
    regimeLowVolatility: 0.1,
    validationLowVolatility: 0.12,
    validationVeryLowVolatility: veryLow,
    scoreRelease: releaseThreshold(normalized)
  };
}

async function run() {
  const [globalResult, byModeResult, distributionResult, historicalResult, recentExamplesResult] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total_cycles,
        COUNT(*) FILTER (WHERE ${LOW_VOLATILITY_REGIME_CONDITION})::int AS low_volatility_regime_cycles,
        COUNT(*) FILTER (WHERE ${LOW_VOLATILITY_VALIDATION_CONDITION})::int AS low_volatility_validation_cycles,
        COUNT(*) FILTER (WHERE ${VERY_LOW_VOLATILITY_CONDITION})::int AS very_low_volatility_cycles,
        COUNT(*) FILTER (WHERE COALESCE(blocked, false) = true)::int AS total_blocks,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_BLOCK_CONDITION}
        )::int AS low_volatility_lost_signals,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${VERY_LOW_VOLATILITY_CONDITION}
            AND ${VOLATILITY_BLOCK_REASON_CONDITION}
        )::int AS very_low_volatility_lost_signals,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${VERY_LOW_VOLATILITY_CONDITION}
            AND ${SCORE_SQL} <= COALESCE(
              CASE ${NORMALIZED_MODE_SQL}
                WHEN 'balanced' THEN 90
                WHEN 'aggressive' THEN 80
                ELSE NULL
              END,
              999999
            )
        )::int AS inferred_hard_block_very_low_volatility
      FROM public.signal_history
    `),
    db.query(`
      SELECT
        ${NORMALIZED_MODE_SQL} AS mode,
        COUNT(*)::int AS total_cycles,
        COUNT(*) FILTER (WHERE ${LOW_VOLATILITY_REGIME_CONDITION})::int AS low_volatility_regime_cycles,
        COUNT(*) FILTER (WHERE ${LOW_VOLATILITY_VALIDATION_CONDITION})::int AS low_volatility_validation_cycles,
        COUNT(*) FILTER (WHERE ${VERY_LOW_VOLATILITY_CONDITION})::int AS very_low_volatility_cycles,
        COUNT(*) FILTER (WHERE COALESCE(blocked, false) = true)::int AS total_blocks,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_BLOCK_CONDITION}
        )::int AS low_volatility_lost_signals,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${VERY_LOW_VOLATILITY_CONDITION}
            AND ${VOLATILITY_BLOCK_REASON_CONDITION}
        )::int AS very_low_volatility_lost_signals,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_BLOCK_CONDITION}
            AND ${SCORE_SQL} > 90
            AND ${NORMALIZED_MODE_SQL} = 'balanced'
        )::int AS balanced_releasable_blocks,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_BLOCK_CONDITION}
            AND ${SCORE_SQL} > 80
            AND ${NORMALIZED_MODE_SQL} = 'aggressive'
        )::int AS aggressive_releasable_blocks
      FROM public.signal_history
      GROUP BY ${NORMALIZED_MODE_SQL}
      ORDER BY mode
    `),
    db.query(`
      SELECT
        ${NORMALIZED_MODE_SQL} AS mode,
        COUNT(*) FILTER (WHERE COALESCE(volatility, 0) > 0)::int AS cycles_with_positive_volatility,
        AVG(NULLIF(volatility, 0)) AS avg_volatility,
        MIN(NULLIF(volatility, 0)) AS min_positive_volatility,
        MAX(NULLIF(volatility, 0)) AS max_positive_volatility,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY NULLIF(volatility, 0)) AS p50_volatility,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY NULLIF(volatility, 0)) AS p75_volatility,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY NULLIF(volatility, 0)) AS p90_volatility,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY NULLIF(volatility, 0)) AS p95_volatility,
        COUNT(*) FILTER (WHERE COALESCE(volatility, 0) >= (${VERY_LOW_THRESHOLD_SQL}) AND COALESCE(volatility, 0) < 0.12)::int AS between_very_low_and_low,
        COUNT(*) FILTER (WHERE COALESCE(volatility, 0) >= 0.12 AND COALESCE(volatility, 0) < 0.18)::int AS just_above_low_threshold
      FROM public.signal_history
      GROUP BY ${NORMALIZED_MODE_SQL}
      ORDER BY mode
    `),
    db.query(`
      SELECT
        ${NORMALIZED_MODE_SQL} AS mode,
        COUNT(*) FILTER (
          WHERE result IN ('win', 'loss')
            AND signal IN ('CALL', 'PUT')
            AND ${LOW_VOLATILITY_BLOCK_CONDITION}
        )::int AS resolved_low_volatility_signals,
        COUNT(*) FILTER (
          WHERE result = 'win'
            AND signal IN ('CALL', 'PUT')
            AND ${LOW_VOLATILITY_BLOCK_CONDITION}
        )::int AS wins,
        COUNT(*) FILTER (
          WHERE result = 'loss'
            AND signal IN ('CALL', 'PUT')
            AND ${LOW_VOLATILITY_BLOCK_CONDITION}
        )::int AS losses
      FROM public.signal_history
      GROUP BY ${NORMALIZED_MODE_SQL}
      ORDER BY mode
    `),
    db.query(`
      SELECT
        created_at,
        symbol,
        ${NORMALIZED_MODE_SQL} AS mode,
        volatility,
        market_regime,
        blocked,
        block_reason,
        ${SCORE_SQL} AS score
      FROM public.signal_history
      WHERE ${LOW_VOLATILITY_BLOCK_CONDITION}
         OR ${VERY_LOW_VOLATILITY_CONDITION}
      ORDER BY created_at DESC
      LIMIT 20
    `)
  ]);

  const global = globalResult.rows[0] || {};
  const distributionByMode = Object.fromEntries(
    distributionResult.rows.map((row) => [normalizeMode(row.mode), row])
  );
  const historicalByMode = Object.fromEntries(
    historicalResult.rows.map((row) => [normalizeMode(row.mode), row])
  );

  const impactByMode = byModeResult.rows.map((row) => {
    const normalized = normalizeMode(row.mode);
    const distribution = distributionByMode[normalized] || {};
    const historical = historicalByMode[normalized] || {};
    const thresholds = thresholdSet(normalized);
    const releasableBlocks = normalized === "balanced"
      ? Number(row.balanced_releasable_blocks || 0)
      : normalized === "aggressive"
        ? Number(row.aggressive_releasable_blocks || 0)
        : 0;

    return {
      mode: normalized,
      thresholds,
      totalCycles: Number(row.total_cycles || 0),
      cyclesWithPositiveVolatility: Number(distribution.cycles_with_positive_volatility || 0),
      lowVolatilityRegimeCycles: Number(row.low_volatility_regime_cycles || 0),
      lowVolatilityRegimeRate: pct(row.low_volatility_regime_cycles, row.total_cycles),
      lowVolatilityValidationCycles: Number(row.low_volatility_validation_cycles || 0),
      lowVolatilityValidationRate: pct(row.low_volatility_validation_cycles, row.total_cycles),
      veryLowVolatilityCycles: Number(row.very_low_volatility_cycles || 0),
      veryLowVolatilityRate: pct(row.very_low_volatility_cycles, row.total_cycles),
      totalBlocks: Number(row.total_blocks || 0),
      lostSignalsByLowVolatilityBlock: Number(row.low_volatility_lost_signals || 0),
      lostSignalsByVeryLowVolatilityBlock: Number(row.very_low_volatility_lost_signals || 0),
      lowVolatilityBlockShare: pct(row.low_volatility_lost_signals, row.total_blocks),
      releasableBlocks,
      releasableLowVolatilityBlockRate: pct(releasableBlocks, row.low_volatility_lost_signals),
      distribution: {
        avg: num(distribution.avg_volatility),
        minPositive: num(distribution.min_positive_volatility),
        maxPositive: num(distribution.max_positive_volatility),
        p50: num(distribution.p50_volatility),
        p75: num(distribution.p75_volatility),
        p90: num(distribution.p90_volatility),
        p95: num(distribution.p95_volatility),
        betweenVeryLowAndLow: Number(distribution.between_very_low_and_low || 0),
        justAboveLowThreshold: Number(distribution.just_above_low_threshold || 0)
      },
      thresholdRigiditySignals: {
        validationLowVolatilityThresholdCapturesP50: Number(distribution.p50_volatility || 0) > 0 && Number(distribution.p50_volatility) < thresholds.validationLowVolatility,
        validationLowVolatilityThresholdCapturesP75: Number(distribution.p75_volatility || 0) > 0 && Number(distribution.p75_volatility) < thresholds.validationLowVolatility,
        veryLowVolatilityThresholdCapturesP50: Number(distribution.p50_volatility || 0) > 0 && Number(distribution.p50_volatility) < thresholds.validationVeryLowVolatility
      },
      historicalResolvedSignals: Number(historical.resolved_low_volatility_signals || 0),
      historicalWins: Number(historical.wins || 0),
      historicalLosses: Number(historical.losses || 0),
      historicalWinrate: pct(historical.wins, historical.resolved_low_volatility_signals)
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    scope: "LOW_VOLATILITY_AND_VERY_LOW_VOLATILITY",
    source: "public.signal_history",
    behaviorChanged: false,
    global: {
      totalCycles: Number(global.total_cycles || 0),
      lowVolatilityRegimeCycles: Number(global.low_volatility_regime_cycles || 0),
      lowVolatilityRegimeRate: pct(global.low_volatility_regime_cycles, global.total_cycles),
      lowVolatilityValidationCycles: Number(global.low_volatility_validation_cycles || 0),
      lowVolatilityValidationRate: pct(global.low_volatility_validation_cycles, global.total_cycles),
      veryLowVolatilityCycles: Number(global.very_low_volatility_cycles || 0),
      veryLowVolatilityRate: pct(global.very_low_volatility_cycles, global.total_cycles),
      totalBlocks: Number(global.total_blocks || 0),
      lostSignalsByLowVolatilityBlock: Number(global.low_volatility_lost_signals || 0),
      lostSignalsByVeryLowVolatilityBlock: Number(global.very_low_volatility_lost_signals || 0),
      inferredHardBlockVeryLowVolatility: Number(global.inferred_hard_block_very_low_volatility || 0),
      lowVolatilityBlockShare: pct(global.low_volatility_lost_signals, global.total_blocks),
      veryLowVolatilityBlockShare: pct(global.very_low_volatility_lost_signals, global.total_blocks)
    },
    impactByMode,
    recentExamples: recentExamplesResult.rows.map((row) => ({
      createdAt: row.created_at,
      symbol: row.symbol,
      mode: normalizeMode(row.mode),
      volatility: num(row.volatility),
      marketRegime: row.market_regime,
      blocked: Boolean(row.blocked),
      blockReason: row.block_reason,
      score: num(row.score, 2)
    }))
  };

  console.log(JSON.stringify(report, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({
      scope: "aerix_low_volatility_audit",
      event: "report_failed",
      error: error.message || String(error)
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
