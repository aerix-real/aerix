const db = require("../config/database");

const MINIMUM_SCORE_SQL = `
  COALESCE(
    NULLIF(minimum_score, 0),
    CASE
      WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 88
      WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 64
      ELSE 72
    END
  )
`;

const CONFIRMED_OPERATIONAL_WHERE = `
  COALESCE(blocked, false) = false
  AND COALESCE(execution_allowed, false) = true
  AND signal IN ('CALL', 'PUT')
  AND COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, 0) >= ${MINIMUM_SCORE_SQL}
`;

const INSTITUTIONAL_FILTERS = {
  predictive_ai_block: {
    label: "Predictive AI Block",
    patterns: ["predictive", "pre_signal", "pre-score", "pre score", "ia preditiva", "antes do sinal"]
  },
  predictive_ai_penalty: {
    label: "Predictive AI Penalty",
    patterns: ["predictive", "pre-score", "pre score", "ia preditiva", "penalizou"]
  },
  adaptive_block: {
    label: "Adaptive Block",
    patterns: ["adaptive", "adaptativa", "anti-loss", "anti loss", "padrão crítico", "padrao critico", "loss"]
  },
  adaptive_penalty: {
    label: "Adaptive Penalty",
    patterns: ["adaptativa reduziu", "adaptive penalty", "histórico", "historico"]
  },
  auto_tuning_penalty: {
    label: "Auto Tuning Penalty",
    patterns: ["auto tuning", "tuning reduziu", "assertividade institucional"]
  },
  sniper_block: {
    label: "Sniper Block",
    patterns: ["sniper", "virada da vela", "janela sniper"]
  },
  sniper_timing_penalty: {
    label: "Sniper Timing Penalty",
    patterns: ["fora da janela sniper", "score reduzido", "virada da vela"]
  },
  execution_block: {
    label: "Execution Block",
    patterns: ["execution", "execução", "execucao", "validação operacional", "validacao operacional", "operacional"]
  },
  execution_penalty: {
    label: "Execution Penalty",
    patterns: ["validação operacional reduziu", "validacao operacional reduziu", "score ajustado"]
  },
  low_score_block: {
    label: "Low Score Block",
    patterns: ["score abaixo", "mínimo institucional", "minimo institucional", "mínimo dinâmico", "minimo dinamico", "low score"]
  },
  dynamic_threshold_penalty: {
    label: "Dynamic Threshold Penalty",
    patterns: ["mínimo aprendido", "minimo aprendido", "threshold", "tratado como penalidade"]
  }
};

const DEFAULT_BLOCK_REASON = "Bloqueio institucional sem motivo detalhado.";
const DEFAULT_PENALTY_REASON = "Penalidade institucional sem motivo detalhado.";

function normalizeLimit(limit, fallback = 50, max = 500) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Number(score.toFixed(2)) : 0;
}

function normalizeAction(action) {
  return String(action || "block").toLowerCase() === "penalty" ? "penalty" : "block";
}

function normalizeFilterName(filterName, fallback = "execution_block") {
  const normalized = String(filterName || "").trim().toLowerCase();
  return INSTITUTIONAL_FILTERS[normalized] ? normalized : fallback;
}

function getFilterLabel(filterName) {
  return INSTITUTIONAL_FILTERS[filterName]?.label || "Execution Block";
}

function classifyFilter(reason = "", signal = {}, action = "block") {
  const explicitFilter = signal.blockFilter || signal.filterName || signal.filter_name;
  if (explicitFilter && INSTITUTIONAL_FILTERS[String(explicitFilter).toLowerCase()]) {
    return normalizeFilterName(explicitFilter);
  }

  const normalizedAction = normalizeAction(action);
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
  if (normalizedAction === "penalty" && context.includes("sniper")) return "sniper_timing_penalty";
  if (normalizedAction === "penalty" && context.includes("predictive")) return "predictive_ai_penalty";
  if (normalizedAction === "penalty" && context.includes("auto tuning")) return "auto_tuning_penalty";
  if (normalizedAction === "penalty" && context.includes("adaptativa")) return "adaptive_penalty";
  if (normalizedAction === "penalty" && context.includes("mínimo aprendido")) return "dynamic_threshold_penalty";
  if (signal.executionAllowed === false || signal.execution?.allowed === false) return "execution_block";
  if (Number(signal.finalScore || signal.final_score || 0) > 0 && context.includes("score abaixo")) return "low_score_block";

  const matched = Object.entries(INSTITUTIONAL_FILTERS).find(([, rule]) =>
    rule.patterns.some((pattern) => context.includes(pattern))
  );

  if (matched) return matched[0];
  return normalizedAction === "penalty" ? "execution_penalty" : "execution_block";
}

function getEventTimestamp(signal = {}, event = {}) {
  const value = event.timestamp || event.eventTimestamp || signal.timestamp || signal.created_at || signal.createdAt;
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function mapExplicitEvent(signal = {}, event = {}, source = "engine") {
  const action = normalizeAction(event.action);
  const filterName = normalizeFilterName(
    event.filterName || event.filter_name,
    action === "penalty" ? "execution_penalty" : "execution_block"
  );
  const originalScore = normalizeScore(
    event.originalScore ?? event.original_score ?? event.score ?? signal.score ?? signal.confidence
  );
  const adjustedScore = normalizeScore(
    event.adjustedScore ?? event.adjusted_score ?? event.finalScore ?? event.final_score ??
    signal.adjustedScore ?? signal.adjusted_score ?? signal.finalScore ?? signal.final_score ?? originalScore
  );

  return {
    userId: signal.user_id || signal.userId || null,
    filterName,
    filterLabel: event.filterLabel || event.filter_label || getFilterLabel(filterName),
    action,
    symbol: event.symbol || signal.symbol || signal.asset || "UNKNOWN",
    score: originalScore,
    finalScore: adjustedScore,
    originalScore,
    adjustedScore,
    reason: String(event.reason || signal.blockReason || signal.block_reason || (action === "penalty" ? DEFAULT_PENALTY_REASON : DEFAULT_BLOCK_REASON)),
    signal: event.signal || signal.signal || signal.direction || "WAIT",
    mode: event.mode || signal.mode || "balanced",
    marketRegime: event.marketRegime || event.market_regime || signal.market_regime || signal.marketRegime || null,
    strategyName: event.strategyName || event.strategy_name || signal.strategy_name || signal.strategyName || signal.strategy || null,
    eventTimestamp: getEventTimestamp(signal, event),
    source
  };
}

function buildExplicitBlockEvents(signal = {}, source = "engine") {
  const blocks = Array.isArray(signal.filterBlocks) ? signal.filterBlocks : [];
  return blocks.filter(Boolean).map((block) => mapExplicitEvent(signal, { ...block, action: "block" }, source));
}

function buildExplicitEfficiencyEvents(signal = {}, source = "engine") {
  const events = Array.isArray(signal.filterEfficiencyEvents) ? signal.filterEfficiencyEvents : [];
  return events.filter(Boolean).map((event) => mapExplicitEvent(signal, event, source));
}

function buildDerivedBlockEvents(signal = {}, source = "engine") {
  const reasons = Array.isArray(signal.blocks) && signal.blocks.length
    ? signal.blocks
    : [signal.blockReason || signal.block_reason || signal.explanation || DEFAULT_BLOCK_REASON];

  const finalScore = normalizeScore(signal.finalScore || signal.final_score || signal.adjustedScore || signal.confidence);

  return reasons
    .filter(Boolean)
    .map((reason) => {
      const filterName = classifyFilter(reason, signal, "block");

      return {
        userId: signal.user_id || signal.userId || null,
        filterName,
        filterLabel: getFilterLabel(filterName),
        action: "block",
        symbol: signal.symbol || signal.asset || "UNKNOWN",
        score: normalizeScore(signal.score ?? signal.confidence ?? finalScore),
        finalScore,
        originalScore: normalizeScore(signal.score ?? signal.confidence ?? finalScore),
        adjustedScore: finalScore,
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
    const key = [event.action, event.filterName, event.symbol, event.reason, event.eventTimestamp?.toISOString?.() || event.eventTimestamp].join("|");
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

function buildEfficiencyEvents(signal = {}, source = "engine") {
  const efficiencyEvents = buildExplicitEfficiencyEvents(signal, source);
  const blockEvents = buildExplicitBlockEvents(signal, source);
  const explicitEvents = dedupeEvents([...efficiencyEvents, ...blockEvents]);

  if (explicitEvents.length) {
    return explicitEvents;
  }

  const blocked = Boolean(signal.blocked || signal.signal === "WAIT" || signal.direction === "WAIT");
  return blocked ? dedupeEvents(buildDerivedBlockEvents(signal, source)) : [];
}

async function insertFilterEvent(event) {
  const result = await db.query(
    `
    INSERT INTO public.filter_block_events
    (
      user_id,
      filter_name,
      filter_label,
      action,
      symbol,
      score,
      final_score,
      original_score,
      adjusted_score,
      reason,
      signal,
      mode,
      market_regime,
      strategy_name,
      source,
      event_timestamp
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *;
    `,
    [
      event.userId,
      event.filterName,
      event.filterLabel,
      event.action,
      event.symbol,
      event.score,
      event.finalScore,
      event.originalScore,
      event.adjustedScore,
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
    saved.push(await insertFilterEvent(event));
  }

  return saved;
}

async function recordFilterEfficiency(signal = {}, source = "engine") {
  const events = buildEfficiencyEvents(signal, source);
  const saved = [];

  for (const event of events) {
    saved.push(await insertFilterEvent(event));
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
      WHERE ${CONFIRMED_OPERATIONAL_WHERE}
    `),
    db.query(`
      SELECT
        COUNT(*)::int AS blocked_signals,
        COUNT(DISTINCT filter_name)::int AS total_filters,
        COUNT(DISTINCT symbol)::int AS total_assets,
        COALESCE(AVG(final_score), 0)::numeric(10,2) AS avg_final_score,
        MAX(event_timestamp) AS last_block_at,
        COUNT(*) FILTER (
          WHERE COALESCE(final_score, 0) >=
            CASE
              WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 88
              WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 64
              ELSE 72
            END
        )::int AS shadow_approved_blocks
      FROM public.filter_block_events
      WHERE COALESCE(action, 'block') = 'block'
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
      WHERE COALESCE(action, 'block') = 'block'
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
      WHERE COALESCE(action, 'block') = 'block'
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
      WHERE COALESCE(action, 'block') = 'block'
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
      WHERE COALESCE(action, 'block') = 'block'
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
  const blockedRate = totalSignals
    ? Number(((blockedSignals / totalSignals) * 100).toFixed(2))
    : 0;
  const shadowApprovedBlocks = Number(blockSummaryResult.rows[0]?.shadow_approved_blocks || 0);
  const filterEfficiency = blockedSignals
    ? Number((((blockedSignals - shadowApprovedBlocks) / blockedSignals) * 100).toFixed(2))
    : 0;

  return {
    totalSignals,
    analyzedSignals: totalSignals,
    approvedSignals,
    confirmedSignals: approvedSignals,
    blockedSignals,
    blockedAnalyses: blockedSignals,
    approvalRate,
    blockedRate,
    filterEfficiency,
    shadowMode: {
      wouldApproveBlockedSignals: shadowApprovedBlocks,
      blockedSignals,
      filterEfficiency,
      description: "Valida quantos bloqueios ainda ficariam aprovados por score no Shadow Mode."
    },
    blocksByFilter: filterResult.rows,
    topBlockingFilters: filterResult.rows,
    blocksByAsset: assetResult.rows,
    blocksByHour: hourResult.rows,
    summary: {
      total_blocks: blockedSignals,
      total_filters: Number(blockSummaryResult.rows[0]?.total_filters || 0),
      total_assets: Number(blockSummaryResult.rows[0]?.total_assets || 0),
      avg_score: Number(blockSummaryResult.rows[0]?.avg_final_score || 0),
      last_block_at: blockSummaryResult.rows[0]?.last_block_at || null,
      blocked_rate: blockedRate,
      filter_efficiency: filterEfficiency,
      shadow_approved_blocks: shadowApprovedBlocks
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

async function getEfficiencySummary({ limit = 100, rankingLimit = 20 } = {}) {
  const recentLimit = normalizeLimit(limit, 100, 1000);
  const topLimit = normalizeLimit(rankingLimit, 20, 100);

  const [approvedResult, blockedResult, penaltyResult, blocksByFilterResult, penaltiesByFilterResult, blocksByAssetResult, blocksByModeResult, recentEventsResult] = await Promise.all([
    db.query(`
      SELECT COUNT(*)::int AS total_approved
      FROM public.signal_history
      WHERE ${CONFIRMED_OPERATIONAL_WHERE}
    `),
    db.query(`
      SELECT COUNT(DISTINCT CONCAT(symbol, '|', DATE_TRUNC('second', event_timestamp), '|', source))::int AS total_blocked
      FROM public.filter_block_events
      WHERE COALESCE(action, 'block') = 'block'
    `),
    db.query(`
      SELECT COUNT(*)::int AS total_penalties
      FROM public.filter_block_events
      WHERE action = 'penalty'
    `),
    db.query(
      `
      SELECT
        filter_name AS "filterName",
        filter_label AS "filterLabel",
        COUNT(*)::int AS total,
        COUNT(DISTINCT symbol)::int AS "affectedAssets",
        COALESCE(AVG(original_score), 0)::numeric(10,2) AS "avgOriginalScore",
        COALESCE(AVG(adjusted_score), 0)::numeric(10,2) AS "avgAdjustedScore",
        MAX(event_timestamp) AS "lastEventAt"
      FROM public.filter_block_events
      WHERE COALESCE(action, 'block') = 'block'
      GROUP BY filter_name, filter_label
      ORDER BY total DESC, "lastEventAt" DESC
      LIMIT $1
      `,
      [topLimit]
    ),
    db.query(
      `
      SELECT
        filter_name AS "filterName",
        filter_label AS "filterLabel",
        COUNT(*)::int AS total,
        COUNT(DISTINCT symbol)::int AS "affectedAssets",
        COALESCE(AVG(original_score - adjusted_score), 0)::numeric(10,2) AS "avgPenaltyImpact",
        COALESCE(AVG(original_score), 0)::numeric(10,2) AS "avgOriginalScore",
        COALESCE(AVG(adjusted_score), 0)::numeric(10,2) AS "avgAdjustedScore",
        MAX(event_timestamp) AS "lastEventAt"
      FROM public.filter_block_events
      WHERE action = 'penalty'
      GROUP BY filter_name, filter_label
      ORDER BY total DESC, "lastEventAt" DESC
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
        MAX(event_timestamp) AS "lastEventAt"
      FROM public.filter_block_events
      WHERE COALESCE(action, 'block') = 'block'
      GROUP BY symbol
      ORDER BY total DESC, "lastEventAt" DESC
      LIMIT $1
      `,
      [topLimit]
    ),
    db.query(
      `
      SELECT
        mode,
        COUNT(*)::int AS total,
        COUNT(DISTINCT filter_name)::int AS "filtersTriggered",
        COUNT(DISTINCT symbol)::int AS "affectedAssets",
        MAX(event_timestamp) AS "lastEventAt"
      FROM public.filter_block_events
      WHERE COALESCE(action, 'block') = 'block'
      GROUP BY mode
      ORDER BY total DESC, mode ASC
      LIMIT $1
      `,
      [topLimit]
    ),
    db.query(
      `
      SELECT
        filter_name AS "filterName",
        action,
        symbol,
        mode,
        original_score AS "originalScore",
        adjusted_score AS "adjustedScore",
        reason,
        event_timestamp AS timestamp
      FROM public.filter_block_events
      ORDER BY event_timestamp DESC, created_at DESC
      LIMIT $1
      `,
      [recentLimit]
    )
  ]);

  const totalApproved = Number(approvedResult.rows[0]?.total_approved || 0);
  const totalBlocked = Number(blockedResult.rows[0]?.total_blocked || 0);
  const totalPenalties = Number(penaltyResult.rows[0]?.total_penalties || 0);
  const totalAnalyzed = totalApproved + totalBlocked;
  const approvalRate = totalAnalyzed ? Number(((totalApproved / totalAnalyzed) * 100).toFixed(2)) : 0;
  const blockedRate = totalAnalyzed ? Number(((totalBlocked / totalAnalyzed) * 100).toFixed(2)) : 0;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    totalAnalyzed,
    totalApproved,
    totalBlocked,
    approvalRate,
    blockedRate,
    totalPenalties,
    penaltiesByFilter: penaltiesByFilterResult.rows,
    blocksByFilter: blocksByFilterResult.rows,
    blocksByAsset: blocksByAssetResult.rows,
    blocksByMode: blocksByModeResult.rows,
    recentEvents: recentEventsResult.rows,
    shadowMode: {
      compatible: true,
      description: "Métricas internas preservam bloqueios e penalidades sem aprovar execuções em Shadow Mode."
    }
  };
}

module.exports = {
  recordBlockedSignal,
  recordFilterEfficiency,
  getSummary,
  getEfficiencySummary,
  buildBlockEvents,
  buildEfficiencyEvents
};
