const db = require("../config/database");

const FILTER_RULES = [
  {
    name: "predictive_ai_gate",
    label: "IA preditiva",
    patterns: ["ia preditiva", "pre_blocked", "pre_signal"]
  },
  {
    name: "data_quality_filter",
    label: "Qualidade da fonte de dados",
    patterns: ["fallback", "fonte de dados", "dados em fallback"]
  },
  {
    name: "volatility_filter",
    label: "Filtro de volatilidade",
    patterns: ["baixa volatilidade", "volatilidade insuficiente", "mercado lateral"]
  },
  {
    name: "timeframe_alignment_filter",
    label: "Alinhamento multi-timeframe",
    patterns: ["falta de alinhamento", "sem alinhamento", "timeframes", "direção dominante"]
  },
  {
    name: "candle_history_filter",
    label: "Histórico mínimo de candles",
    patterns: ["histórico insuficiente", "candles"]
  },
  {
    name: "dynamic_score_filter",
    label: "Score mínimo dinâmico",
    patterns: ["mínimo dinâmico", "score abaixo"]
  },
  {
    name: "auto_tuning_filter",
    label: "Auto tuning institucional",
    patterns: ["auto tuning", "tuning"]
  },
  {
    name: "sniper_timing_filter",
    label: "Janela sniper de entrada",
    patterns: ["janela sniper", "virada da vela", "sniper"]
  },
  {
    name: "execution_validation_filter",
    label: "Validação operacional",
    patterns: ["validação operacional", "execução", "execution"]
  },
  {
    name: "adaptive_ai_filter",
    label: "IA adaptativa",
    patterns: ["ia adaptativa", "adaptativa", "anti-loss", "anti loss"]
  }
];

function normalizeLimit(limit, fallback = 50, max = 500) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Number(score.toFixed(2)) : 0;
}

function classifyFilter(reason = "", signal = {}) {
  const context = [
    reason,
    signal.strategyName,
    signal.strategy_name,
    signal.timing_mode,
    signal.market_regime,
    signal.institutional_quality
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matched = FILTER_RULES.find((rule) =>
    rule.patterns.some((pattern) => context.includes(pattern))
  );

  if (matched) {
    return {
      filterName: matched.name,
      filterLabel: matched.label
    };
  }

  return {
    filterName: signal.blockFilter || signal.filterName || "institutional_quality_filter",
    filterLabel: signal.blockFilterLabel || signal.filterLabel || "Filtro de qualidade institucional"
  };
}

function buildBlockEvents(signal = {}, source = "engine") {
  const reasons = Array.isArray(signal.blocks) && signal.blocks.length
    ? signal.blocks
    : [signal.blockReason || signal.block_reason || signal.explanation || "Bloqueio institucional sem motivo detalhado."];

  return reasons
    .filter(Boolean)
    .map((reason) => {
      const filter = classifyFilter(reason, signal);

      return {
        userId: signal.user_id || signal.userId || null,
        filterName: filter.filterName,
        filterLabel: filter.filterLabel,
        symbol: signal.symbol || signal.asset || "UNKNOWN",
        score: normalizeScore(signal.finalScore || signal.final_score || signal.adjustedScore || signal.confidence),
        reason: String(reason),
        signal: signal.signal || signal.direction || "WAIT",
        mode: signal.mode || "balanced",
        marketRegime: signal.market_regime || signal.marketRegime || null,
        strategyName: signal.strategy_name || signal.strategyName || signal.strategy || null,
        source
      };
    });
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
      reason,
      signal,
      mode,
      market_regime,
      strategy_name,
      source
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *;
    `,
    [
      event.userId,
      event.filterName,
      event.filterLabel,
      event.symbol,
      event.score,
      event.reason,
      event.signal,
      event.mode,
      event.marketRegime,
      event.strategyName,
      event.source || "engine"
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

  const [summaryResult, rankingResult, recentResult] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total_blocks,
        COUNT(DISTINCT filter_name)::int AS total_filters,
        COUNT(DISTINCT symbol)::int AS total_assets,
        COALESCE(AVG(score), 0)::numeric(10,2) AS avg_score,
        MAX(created_at) AS last_block_at
      FROM public.filter_block_events
    `),
    db.query(
      `
      SELECT
        filter_name,
        filter_label,
        COUNT(*)::int AS total_blocks,
        COUNT(DISTINCT symbol)::int AS affected_assets,
        COALESCE(AVG(score), 0)::numeric(10,2) AS avg_score,
        MAX(created_at) AS last_block_at
      FROM public.filter_block_events
      GROUP BY filter_name, filter_label
      ORDER BY total_blocks DESC, last_block_at DESC
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
        score,
        reason,
        signal,
        mode,
        market_regime,
        strategy_name,
        source,
        created_at
      FROM public.filter_block_events
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [recentLimit]
    )
  ]);

  return {
    summary: summaryResult.rows[0] || {
      total_blocks: 0,
      total_filters: 0,
      total_assets: 0,
      avg_score: 0,
      last_block_at: null
    },
    ranking: rankingResult.rows,
    recentBlocks: recentResult.rows
  };
}

module.exports = {
  classifyFilter,
  buildBlockEvents,
  recordBlockedSignal,
  getSummary
};
