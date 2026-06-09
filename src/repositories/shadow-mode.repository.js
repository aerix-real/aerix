const db = require("../config/database");
const { buildBlockEvents } = require("./filter-analytics.repository");

function normalizeLimit(limit, fallback = 50, max = 500) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Number(score.toFixed(2)) : 0;
}

function normalizeDirection(signal = {}) {
  return String(signal.signal || signal.direction || "WAIT").toUpperCase();
}

function isTrackableOriginalSignal(originalSignal = {}) {
  return ["CALL", "PUT"].includes(normalizeDirection(originalSignal));
}

function resolveExpiresAt(signal = {}) {
  const expiresAt = signal.expires_at || signal.expiry || signal.expiration || signal.expiryAt;
  if (!expiresAt) return null;

  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildShadowEvents({ blockedSignal = {}, originalSignal = {}, source = "engine", blockEvents = [] } = {}) {
  if (!isTrackableOriginalSignal(originalSignal)) return [];

  const events = Array.isArray(blockEvents) && blockEvents.length
    ? blockEvents.map((event) => ({
        filterBlockEventId: event.id || event.filter_block_event_id || null,
        filterName: event.filter_name || event.filterName,
        filterLabel: event.filter_label || event.filterLabel,
        reason: event.reason
      }))
    : buildBlockEvents(blockedSignal, source).map((event) => ({
        filterBlockEventId: null,
        filterName: event.filterName,
        filterLabel: event.filterLabel,
        reason: event.reason
      }));

  const direction = normalizeDirection(originalSignal);
  const score = normalizeScore(originalSignal.finalScore || originalSignal.final_score || originalSignal.adjustedScore || originalSignal.confidence);
  const confidence = normalizeScore(originalSignal.confidence || score);

  return events.map((event) => ({
    filterBlockEventId: event.filterBlockEventId,
    userId: blockedSignal.user_id || blockedSignal.userId || originalSignal.user_id || originalSignal.userId || null,
    filterName: event.filterName || "institutional_quality_filter",
    filterLabel: event.filterLabel || "Filtro de qualidade institucional",
    symbol: originalSignal.symbol || originalSignal.asset || blockedSignal.symbol || blockedSignal.asset || "UNKNOWN",
    originalSignal,
    originalDirection: direction,
    originalScore: score,
    originalConfidence: confidence,
    entryPrice: originalSignal.entry_price ?? originalSignal.entryPrice ?? originalSignal.price ?? blockedSignal.entry_price ?? blockedSignal.entryPrice ?? blockedSignal.price ?? null,
    blockReason: event.reason || blockedSignal.blockReason || blockedSignal.block_reason || "Bloqueio institucional sem motivo detalhado.",
    mode: originalSignal.mode || blockedSignal.mode || "balanced",
    marketRegime: originalSignal.market_regime || originalSignal.marketRegime || blockedSignal.market_regime || blockedSignal.marketRegime || null,
    strategyName: originalSignal.strategy_name || originalSignal.strategyName || originalSignal.strategy || blockedSignal.strategy_name || blockedSignal.strategyName || null,
    source,
    expiresAt: resolveExpiresAt(originalSignal) || resolveExpiresAt(blockedSignal)
  }));
}

async function insertShadowEvent(event) {
  const result = await db.query(
    `
    INSERT INTO public.shadow_mode_events
    (
      filter_block_event_id,
      user_id,
      filter_name,
      filter_label,
      symbol,
      original_signal,
      original_direction,
      original_score,
      original_confidence,
      entry_price,
      block_reason,
      mode,
      market_regime,
      strategy_name,
      source,
      expires_at
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *;
    `,
    [
      event.filterBlockEventId,
      event.userId,
      event.filterName,
      event.filterLabel,
      event.symbol,
      JSON.stringify(event.originalSignal || {}),
      event.originalDirection,
      event.originalScore,
      event.originalConfidence,
      event.entryPrice,
      event.blockReason,
      event.mode,
      event.marketRegime,
      event.strategyName,
      event.source || "engine",
      event.expiresAt
    ]
  );

  return result.rows[0];
}

async function recordShadowBlock(payload = {}) {
  const events = buildShadowEvents(payload);
  const saved = [];

  for (const event of events) {
    saved.push(await insertShadowEvent(event));
  }

  return saved;
}

async function getExpiredPending(limit = 50) {
  const result = await db.query(
    `
    SELECT *
    FROM public.shadow_mode_events
    WHERE result = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    ORDER BY expires_at ASC
    LIMIT $1
    `,
    [normalizeLimit(limit, 50, 500)]
  );

  return result.rows;
}

async function finalizeShadowResult(id, { result, resultPrice }) {
  const normalizedResult = String(result || "loss").toLowerCase() === "win" ? "win" : "loss";
  const comparison = normalizedResult === "loss" ? "saved_loss" : "lost_win";

  const response = await db.query(
    `
    UPDATE public.shadow_mode_events
    SET
      result = $1,
      result_price = $2,
      comparison = $3,
      checked_at = NOW()
    WHERE id = $4
    RETURNING *
    `,
    [normalizedResult, resultPrice, comparison, id]
  );

  return response.rows[0] || null;
}

async function getSummary({ limit = 50, rankingLimit = 20 } = {}) {
  const recentLimit = normalizeLimit(limit, 50, 500);
  const topLimit = normalizeLimit(rankingLimit, 20, 100);

  const [summaryResult, rankingResult, recentResult] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total_tracked,
        COUNT(*) FILTER (WHERE result = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE comparison = 'saved_loss')::int AS saved_losses,
        COUNT(*) FILTER (WHERE comparison = 'lost_win')::int AS lost_wins,
        CASE
          WHEN COUNT(*) FILTER (WHERE result IN ('win', 'loss')) = 0 THEN 0
          ELSE ROUND(((COUNT(*) FILTER (WHERE comparison = 'saved_loss'))::numeric / (COUNT(*) FILTER (WHERE result IN ('win', 'loss')))::numeric) * 100, 0)
        END::int AS filter_accuracy,
        MAX(checked_at) AS last_checked_at,
        MAX(created_at) AS last_shadow_at
      FROM public.shadow_mode_events
    `),
    db.query(
      `
      SELECT
        filter_name,
        filter_label,
        COUNT(*)::int AS total_tracked,
        COUNT(*) FILTER (WHERE result = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE comparison = 'saved_loss')::int AS saved_losses,
        COUNT(*) FILTER (WHERE comparison = 'lost_win')::int AS lost_wins,
        CASE
          WHEN COUNT(*) FILTER (WHERE result IN ('win', 'loss')) = 0 THEN 0
          ELSE ROUND(((COUNT(*) FILTER (WHERE comparison = 'saved_loss'))::numeric / (COUNT(*) FILTER (WHERE result IN ('win', 'loss')))::numeric) * 100, 0)
        END::int AS filter_accuracy,
        MAX(checked_at) AS last_checked_at
      FROM public.shadow_mode_events
      GROUP BY filter_name, filter_label
      ORDER BY filter_accuracy DESC, saved_losses DESC, total_tracked DESC
      LIMIT $1
      `,
      [topLimit]
    ),
    db.query(
      `
      SELECT
        id,
        filter_name,
        filter_label,
        symbol,
        original_direction,
        original_score,
        block_reason,
        result,
        comparison,
        expires_at,
        checked_at,
        created_at
      FROM public.shadow_mode_events
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [recentLimit]
    )
  ]);

  const summary = summaryResult.rows[0] || {};

  return {
    summary: {
      totalTracked: Number(summary.total_tracked || 0),
      pending: Number(summary.pending || 0),
      savedLosses: Number(summary.saved_losses || 0),
      lostWins: Number(summary.lost_wins || 0),
      filterAccuracy: Number(summary.filter_accuracy || 0),
      lastCheckedAt: summary.last_checked_at || null,
      lastShadowAt: summary.last_shadow_at || null
    },
    filters: rankingResult.rows.map((row) => ({
      filterName: row.filter_name,
      filterLabel: row.filter_label,
      totalTracked: Number(row.total_tracked || 0),
      pending: Number(row.pending || 0),
      savedLosses: Number(row.saved_losses || 0),
      lostWins: Number(row.lost_wins || 0),
      filterAccuracy: Number(row.filter_accuracy || 0),
      lastCheckedAt: row.last_checked_at || null
    })),
    recent: recentResult.rows
  };
}

module.exports = {
  buildShadowEvents,
  recordShadowBlock,
  getExpiredPending,
  finalizeShadowResult,
  getSummary
};
