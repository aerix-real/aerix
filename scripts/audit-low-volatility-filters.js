const db = require("../src/config/database");

const LOW_VOLATILITY_CONDITION = `
  (
    (COALESCE(volatility, 0) > 0 AND COALESCE(volatility, 0) < 0.12)
    OR UPPER(COALESCE(market_regime, '')) = 'LOW_VOLATILITY'
    OR LOWER(COALESCE(block_reason, '')) LIKE '%volatil%'
    OR LOWER(COALESCE(block_reason, '')) LIKE '%volat%'
  )
`;

const SCORE_SQL = "COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, 0)";

function pct(part, total) {
  const numerator = Number(part || 0);
  const denominator = Number(total || 0);

  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
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

async function run() {
  const [globalResult, byModeResult, historicalResult] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total_signals,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_CONDITION}
        )::int AS low_volatility_blocks,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
        )::int AS total_blocks
      FROM public.signal_history
    `),
    db.query(`
      SELECT
        LOWER(COALESCE(mode, 'balanced')) AS mode,
        COUNT(*)::int AS total_signals,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
        )::int AS total_blocks,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_CONDITION}
        )::int AS low_volatility_blocks,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_CONDITION}
            AND LOWER(COALESCE(mode, 'balanced')) IN ('equilibrado', 'balanced')
            AND ${SCORE_SQL} > 90
        )::int AS balanced_releasable_blocks,
        COUNT(*) FILTER (
          WHERE COALESCE(blocked, false) = true
            AND ${LOW_VOLATILITY_CONDITION}
            AND LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive')
            AND ${SCORE_SQL} > 80
        )::int AS aggressive_releasable_blocks
      FROM public.signal_history
      GROUP BY LOWER(COALESCE(mode, 'balanced'))
      ORDER BY mode
    `),
    db.query(`
      SELECT
        LOWER(COALESCE(mode, 'balanced')) AS mode,
        COUNT(*) FILTER (
          WHERE result IN ('win', 'loss')
            AND signal IN ('CALL', 'PUT')
            AND ${LOW_VOLATILITY_CONDITION}
        )::int AS resolved_low_volatility_signals,
        COUNT(*) FILTER (
          WHERE result = 'win'
            AND signal IN ('CALL', 'PUT')
            AND ${LOW_VOLATILITY_CONDITION}
        )::int AS wins,
        COUNT(*) FILTER (
          WHERE result = 'loss'
            AND signal IN ('CALL', 'PUT')
            AND ${LOW_VOLATILITY_CONDITION}
        )::int AS losses
      FROM public.signal_history
      GROUP BY LOWER(COALESCE(mode, 'balanced'))
      ORDER BY mode
    `)
  ]);

  const global = globalResult.rows[0] || {};
  const historicalByMode = Object.fromEntries(
    historicalResult.rows.map((row) => [normalizeMode(row.mode), row])
  );

  const impactByMode = byModeResult.rows.map((row) => {
    const normalized = normalizeMode(row.mode);
    const historical = historicalByMode[normalized] || {};
    const releasableBlocks = normalized === "balanced"
      ? Number(row.balanced_releasable_blocks || 0)
      : normalized === "aggressive"
        ? Number(row.aggressive_releasable_blocks || 0)
        : 0;

    return {
      mode: normalized,
      threshold: releaseThreshold(normalized),
      totalSignals: Number(row.total_signals || 0),
      totalBlocks: Number(row.total_blocks || 0),
      lowVolatilityBlocks: Number(row.low_volatility_blocks || 0),
      lowVolatilityBlockRate: pct(row.low_volatility_blocks, row.total_signals),
      shareOfAllBlocks: pct(row.low_volatility_blocks, row.total_blocks),
      releasableBlocks,
      releasableLowVolatilityBlockRate: pct(releasableBlocks, row.low_volatility_blocks),
      historicalResolvedSignals: Number(historical.resolved_low_volatility_signals || 0),
      historicalWins: Number(historical.wins || 0),
      historicalLosses: Number(historical.losses || 0),
      historicalWinrate: pct(historical.wins, historical.resolved_low_volatility_signals)
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    scope: "LOW_VOLATILITY",
    source: "public.signal_history",
    global: {
      totalSignals: Number(global.total_signals || 0),
      totalBlocks: Number(global.total_blocks || 0),
      lowVolatilityBlocks: Number(global.low_volatility_blocks || 0),
      lowVolatilityBlockRate: pct(global.low_volatility_blocks, global.total_signals),
      shareOfAllBlocks: pct(global.low_volatility_blocks, global.total_blocks)
    },
    impactByMode
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
