const db = require("../config/database");

const INSTITUTIONAL_FILTERS = {
  predictive_ai_block: {
    label: "Predictive AI Block",
    patterns: ["predictive", "pre_signal", "pre-score", "pre score", "ia preditiva", "antes do sinal"]
  },
  adaptive_block: {
    label: "Adaptive Block",
    patterns: ["adaptive", "adaptativa", "anti-loss", "anti loss", "padrão crítico", "padrao critico", "loss"]
  },
  sniper_block: {
    label: "Sniper Block",
    patterns: ["sniper", "virada da vela", "janela sniper"]
  },
  execution_block: {
    label: "Execution Block",
    patterns: ["execution", "execução", "execucao", "validação operacional", "validacao operacional", "operacional"]
  },
  low_score_block: {
    label: "Low Score Block",
    patterns: ["score abaixo", "mínimo institucional", "minimo institucional", "mínimo dinâmico", "minimo dinamico", "low score"]
  }
};

const DEFAULT_BLOCK_REASON = "Bloqueio institucional sem motivo detalhado.";

function normalizeLimit(limit, fallback = 50, max = 500) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Number(score.toFixed(2)) : 0;
}

function normalizeFilterName(filterName) {
  const normalized = String(filterName || "").trim().toLowerCase();
  return INSTITUTIONAL_FILTERS[normalized] ? normalized : "execution_block";
}

function getFilterLabel(filterName) {
  return INSTITUTIONAL_FILTERS[filterName]?.label || "Execution Block";
}

function classifyFilter(reason = "", signal = {}) {
  const explicitFilter = signal.blockFilter || signal.filterName || signal.filter_name;
  if (explicitFilter && INSTITUTIONAL_FILTERS[String(explicitFilter).toLowerCase()]) {
    return normalizeFilterName(explicitFilter);
  }

  const context = [
    reason,
    signal.strategyName,
    signal.strategy_name,
    signal.timing_mode,
    signal.market_regime,
    signal.institutional_quality,
    signal.blockReason,
    signal.block_reason,
    signal.execution?.reason,
    signal.aiBlock?.reason
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (signal.predictiveAi?.blocked || signal.predictive_ai?.blocked) return "predictive_ai_block";
  if (signal.executionAllowed === false || signal.execution?.allowed === false) return "execution_block";
  if (Number(signal.finalScore || signal.final_score || 0) > 0 && context.includes("score abaixo")) return "low_score_block";

  const matched = Object.entries(INSTITUTIONAL_FILTERS).find(([, rule]) =>
    rule.patterns.some((pattern) => context.includes(pattern))
  );

  return matched ? matched[0] : "execution_block";
}

function getEventTimestamp(signal = {}, block = {}) {
  const value = block.timestamp || signal.timestamp || signal.created_at || signal.createdAt;
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function buildExplicitBlockEvents(signal = {}, source = "engine") {
  const blocks = Array.isArray(signal.filterBlocks) ? signal.filterBlocks : [];

  return blocks
    .filter(Boolean)
    .map((block) => {
      const filterName = normalizeFilterName(block.filterName || block.filter_name);
      const finalScore = normalizeScore(block.finalScore ?? block.final_score ?? signal.finalScore ?? signal.final_score);

      return {
        userId: signal.user_id || signal.userId || null,
        filterName,
        filterLabel: block.filterLabel || block.filter_label || getFilterLabel(filterName),
        symbol: block.symbol || signal.symbol || signal.asset || "UNKNOWN",
        score: normalizeScore(block.score ?? signal.score ?? signal.confidence ?? finalScore),
        finalScore,
        reason: String(block.reason || signal.blockReason || signal.block_reason || DEFAULT_BLOCK_REASON),
        signal: block.signal || signal.signal || signal.direction || "WAIT",
        mode: block.mode || signal.mode || "balanced",
        marketRegime: block.marketRegime || block.market_regime || signal.market_regime || signal.marketRegime || null,
        strategyName: block.strategyName || block.strategy_name || signal.strategy_name || signal.strategyName || signal.strategy || null,
        eventTimestamp: getEventTimestamp(signal, block),
        source
      };
    });
}

function buildDerivedBlockEvents(signal = {}, source = "engine") {
  const reasons = Array.isArray(signal.blocks) && signal.blocks.length
    ? signal.blocks
    : [signal.blockReason || signal.block_reason || signal.explanation || DEFAULT_BLOCK_REASON];

  const finalScore = normalizeScore(signal.finalScore || signal.final_score || signal.adjustedScore || signal.confidence);

  return reasons
    .filter(Boolean)
    .map((reason) => {
      const filterName = classifyFilter(reason, signal);

      return {
        userId: signal.user_id || signal.userId || null,
        filterName,
        filterLabel: getFilterLabel(filterName),
        symbol: signal.symbol || signal.asset || "UNKNOWN",
        score: normalizeScore(signal.score ?? signal.confidence ?? finalScore),
        finalScore,
        reason: String(reason),
        signal: signal.signal || signal.direction || "WAIT",
        mode: signal.mode || "balanced",
        marketRegime: signal.market_regime || signal.marketRegime || null,
        strategyName: signal.strategy_name || signal.strategyName || signal.strategy || null,
        eventTimestamp: getEventTimestamp(signal),
        source
      };
    });
}

function dedupeEvents(events = []) {
  const seen = new Set();

  return events.filter((event) => {
    const key = [event.filterName, event.symbol, event.reason].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildBlockEvents(signal = {}, source = "engine") {
  const explicitEvents = buildExplicitBlockEvents(signal, source);
  if (explicitEvents.length) return dedupeEvents(explicitEvents);

  return dedupeEvents(buildDerivedBlockEvents(signal, source));
}

async function insertBlockEvent(event) {
  const result = await db.query(
    `
    INSERT INTO public.filter_block_events
    (
      user_id,
      filter_name,
      filter_label,
      symbol,
      score,
      final_score,
      reason,
      signal,
      mode,
      market_regime,
      strategy_name,
      source,
      event_timestamp
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *;
    `,
    [
      event.userId,
      event.filterName,
      event.filterLabel,
      event.symbol,
      event.score,
      event.finalScore,
      event.reason,
      event.signal,
      event.mode,
      event.marketRegime,
      event.strategyName,
      event.source || "engine",
      event.eventTimestamp
    ]
  );

  return result.rows[0];
}

async function recordBlockedSignal(signal = {}, source = "engine") {
  const blocked = Boolean(signal.blocked || signal.signal === "WAIT" || signal.direction === "WAIT");
  if (!blocked) return [];

  const events = buildBlockEvents(signal, source);
  const saved = [];

  for (const event of events) {
    saved.push(await insertBlockEvent(event));
  }

  return saved;
}

async function getSummary({ limit = 50, rankingLimit = 10 } = {}) {
  const recentLimit = normalizeLimit(limit, 50, 500);
  const topLimit = normalizeLimit(rankingLimit, 10, 100);

  const [signalsResult, blockSummaryResult, filterResult, assetResult, hourResult, recentResult] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS approved_signals
      FROM public.signal_history
      WHERE COALESCE(blocked, false) = false
        AND signal IN ('CALL', 'PUT')
    `),
    db.query(`
      SELECT
        COUNT(*)::int AS blocked_signals,
        COUNT(DISTINCT filter_name)::int AS total_filters,
        COUNT(DISTINCT symbol)::int AS total_assets,
        COALESCE(AVG(final_score), 0)::numeric(10,2) AS avg_final_score,
        MAX(event_timestamp) AS last_block_at
      FROM public.filter_block_events
    `),
    db.query(
      `
      SELECT
        filter_name AS "filterName",
        filter_label AS "filterLabel",
        COUNT(*)::int AS total,
        COUNT(DISTINCT symbol)::int AS "affectedAssets",
        COALESCE(AVG(score), 0)::numeric(10,2) AS "avgScore",
        COALESCE(AVG(final_score), 0)::numeric(10,2) AS "avgFinalScore",
        MAX(event_timestamp) AS "lastBlockAt"
      FROM public.filter_block_events
      GROUP BY filter_name, filter_label
      ORDER BY total DESC, "lastBlockAt" DESC
      LIMIT $1
      `,
      [topLimit]
    ),
    db.query(
      `
      SELECT
        symbol,
        COUNT(*)::int AS total,
        COUNT(DISTINCT filter_name)::int AS "filtersTriggered",
        COALESCE(AVG(final_score), 0)::numeric(10,2) AS "avgFinalScore",
        MAX(event_timestamp) AS "lastBlockAt"
      FROM public.filter_block_events
      GROUP BY symbol
      ORDER BY total DESC, "lastBlockAt" DESC
      LIMIT $1
      `,
      [topLimit]
    ),
    db.query(`
      SELECT
        EXTRACT(HOUR FROM event_timestamp)::int AS hour,
        COUNT(*)::int AS total,
        COUNT(DISTINCT symbol)::int AS "affectedAssets"
      FROM public.filter_block_events
      GROUP BY hour
      ORDER BY total DESC, hour ASC
    `),
    db.query(
      `
      SELECT
        id,
        filter_name AS "filterName",
        filter_label AS "filterLabel",
        symbol,
        score,
        final_score AS "finalScore",
        reason,
        signal,
        mode,
        market_regime AS "marketRegime",
        strategy_name AS "strategyName",
        source,
        event_timestamp AS timestamp,
        created_at AS "createdAt"
      FROM public.filter_block_events
      ORDER BY event_timestamp DESC, created_at DESC
      LIMIT $1
      `,
      [recentLimit]
    )
  ]);

  const approvedSignals = Number(signalsResult.rows[0]?.approved_signals || 0);
  const blockedSignals = Number(blockSummaryResult.rows[0]?.blocked_signals || 0);
  const totalSignals = approvedSignals + blockedSignals;
  const approvalRate = totalSignals
    ? Number(((approvedSignals / totalSignals) * 100).toFixed(2))
    : 0;

  return {
    totalSignals,
    approvedSignals,
    blockedSignals,
    approvalRate,
    blocksByFilter: filterResult.rows,
    blocksByAsset: assetResult.rows,
    blocksByHour: hourResult.rows,
    summary: {
      total_blocks: blockedSignals,
      total_filters: Number(blockSummaryResult.rows[0]?.total_filters || 0),
      total_assets: Number(blockSummaryResult.rows[0]?.total_assets || 0),
      avg_score: Number(blockSummaryResult.rows[0]?.avg_final_score || 0),
      last_block_at: blockSummaryResult.rows[0]?.last_block_at || null
    },
    ranking: filterResult.rows.map((row) => ({
      filter_name: row.filterName,
      filter_label: row.filterLabel,
      total_blocks: row.total,
      affected_assets: row.affectedAssets,
      avg_score: row.avgFinalScore,
      last_block_at: row.lastBlockAt
    })),
    recentBlocks: recentResult.rows
  };
}

module.exports = {
  recordBlockedSignal,
  getSummary,
  buildBlockEvents
};
