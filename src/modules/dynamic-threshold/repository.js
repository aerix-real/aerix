const db = require("../../config/database");

async function saveThresholdHistory(data = {}) {
  const result = await db.query(
    `
    INSERT INTO public.threshold_history (
      scope_type,
      scope_key,
      symbol,
      hour,
      strategy_name,
      market_regime,
      mode,
      minimum_score,
      confidence,
      sniper_timing,
      adaptive_adjustment,
      performance_snapshot,
      reasons
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
    `,
    [
      data.scopeType || data.scope_type || "composite",
      data.scopeKey || data.scope_key || "global",
      data.symbol || null,
      data.hour ?? null,
      data.strategyName || data.strategy_name || null,
      data.marketRegime || data.market_regime || null,
      data.mode || "balanced",
      Number(data.minimumScore ?? data.minimum_score ?? 72),
      Number(data.confidence ?? 72),
      Number(data.sniperTiming ?? data.sniper_timing ?? 88),
      Number(data.adaptiveAdjustment ?? data.adaptive_adjustment ?? 0),
      JSON.stringify(data.performanceSnapshot || data.performance_snapshot || {}),
      JSON.stringify(data.reasons || [])
    ]
  );

  return result.rows[0] || null;
}

async function saveThresholdChange(change = {}) {
  const result = await db.query(
    `
    INSERT INTO public.threshold_changes (
      scope_type,
      scope_key,
      threshold_name,
      previous_value,
      new_value,
      delta,
      reason,
      context
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
    `,
    [
      change.scopeType || change.scope_type || "composite",
      change.scopeKey || change.scope_key || "global",
      change.thresholdName || change.threshold_name,
      Number(change.previousValue ?? change.previous_value ?? 0),
      Number(change.newValue ?? change.new_value ?? 0),
      Number(change.delta ?? 0),
      change.reason || null,
      JSON.stringify(change.context || {})
    ]
  );

  return result.rows[0] || null;
}

async function upsertThresholdPerformance(performance = {}) {
  const result = await db.query(
    `
    INSERT INTO public.threshold_performance (
      scope_type,
      scope_key,
      symbol,
      hour,
      strategy_name,
      market_regime,
      total,
      wins,
      losses,
      winrate,
      lossrate,
      last_thresholds,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (scope_type, scope_key)
    DO UPDATE SET
      symbol = EXCLUDED.symbol,
      hour = EXCLUDED.hour,
      strategy_name = EXCLUDED.strategy_name,
      market_regime = EXCLUDED.market_regime,
      total = EXCLUDED.total,
      wins = EXCLUDED.wins,
      losses = EXCLUDED.losses,
      winrate = EXCLUDED.winrate,
      lossrate = EXCLUDED.lossrate,
      last_thresholds = EXCLUDED.last_thresholds,
      updated_at = NOW()
    RETURNING *
    `,
    [
      performance.scopeType || performance.scope_type || "composite",
      performance.scopeKey || performance.scope_key || "global",
      performance.symbol || null,
      performance.hour ?? null,
      performance.strategyName || performance.strategy_name || null,
      performance.marketRegime || performance.market_regime || null,
      Number(performance.total || 0),
      Number(performance.wins || 0),
      Number(performance.losses || 0),
      Number(performance.winrate || 0),
      Number(performance.lossrate || 0),
      JSON.stringify(performance.lastThresholds || performance.last_thresholds || {})
    ]
  );

  return result.rows[0] || null;
}

module.exports = {
  saveThresholdHistory,
  saveThresholdChange,
  upsertThresholdPerformance
};
