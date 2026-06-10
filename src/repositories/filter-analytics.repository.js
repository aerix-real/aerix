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
  predictive_ai_penalty: {
    label: "Predictive AI Penalty",
    patterns: ["ia preditiva", "risco moderado", "pre-score"]
  },
  dynamic_threshold_penalty: {
    label: "Dynamic Threshold Penalty",
    patterns: ["penalidade", "mínimo aprendido", "minimo aprendido"]
  },
  market_quality_penalty: {
    label: "Market Quality Penalty",
    patterns: ["volatilidade", "trend strength", "alinhamento"]
  },
  anti_loss_penalty: {
    label: "Anti Loss Penalty",
    patterns: ["anti-loss moderado", "perda moderada", "horário com perda"]
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
        source,
        eventType: block.eventType || block.event_type || "block",
        originalScore: normalizeScore(block.originalScore ?? block.original_score ?? signal.confidence ?? finalScore),
        resultOutcome: block.resultOutcome || block.result_outcome || signal.result || null
      };
    });
}

function buildExplicitPenaltyEvents(signal = {}, source = "engine") {
  const penalties = Array.isArray(signal.filterPenalties) ? signal.filterPenalties : [];

  return penalties
    .filter(Boolean)
    .map((penalty) => {
      const filterName = normalizeFilterName(penalty.filterName || penalty.filter_name);
      const finalScore = normalizeScore(penalty.finalScore ?? penalty.final_score ?? signal.finalScore ?? signal.final_score);

      return {
        userId: signal.user_id || signal.userId || null,
        filterName,
        filterLabel: penalty.filterLabel || penalty.filter_label || getFilterLabel(filterName),
        symbol: penalty.symbol || signal.symbol || signal.asset || "UNKNOWN",
        score: normalizeScore(penalty.score ?? signal.score ?? signal.confidence ?? finalScore),
        finalScore,
        reason: String(penalty.reason || "Penalidade institucional aplicada ao score."),
        signal: penalty.signal || signal.signal || signal.direction || "WAIT",
        mode: penalty.mode || signal.mode || "balanced",
        marketRegime: penalty.marketRegime || penalty.market_regime || signal.market_regime || signal.marketRegime || null,
        strategyName: penalty.strategyName || penalty.strategy_name || signal.strategy_name || signal.strategyName || signal.strategy || null,
        eventTimestamp: getEventTimestamp(signal, penalty),
        source,
        eventType: "penalty",
        originalScore: normalizeScore(penalty.originalScore ?? penalty.original_score ?? signal.confidence ?? finalScore),
        resultOutcome: penalty.resultOutcome || penalty.result_outcome || signal.result || null
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
        source,
        eventType: "block",
        originalScore: normalizeScore(signal.confidence ?? signal.score ?? finalScore),
        resultOutcome: signal.result || null
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

function buildFilterEvents(signal = {}, source = "engine") {
  const blocked = Boolean(signal.blocked || signal.signal === "WAIT" || signal.direction === "WAIT");

  return dedupeEvents([
    ...(blocked ? buildBlockEvents(signal, source) : []),
    ...buildExplicitPenaltyEvents(signal, source)
  ]);
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
      event_timestamp,
      event_type,
      original_score,
      result_outcome
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
      event.eventTimestamp,
      event.eventType || "block",
      event.originalScore ?? event.score,
      event.resultOutcome || null
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

async function recordSignalFilters(signal = {}, source = "engine") {
  const events = buildFilterEvents(signal, source);
  const saved = [];

  for (const event of events) {
    saved.push(await insertBlockEvent(event));
  }

  return saved;
}

async function updateShadowOutcomes(signal = {}, resultOutcome = null) {
  const normalizedResult = String(resultOutcome || signal.result || "").toLowerCase();
  if (!["win", "loss"].includes(normalizedResult)) return 0;

  const result = await db.query(
    `
    UPDATE public.filter_block_events
    SET result_outcome = $1
    WHERE result_outcome IS NULL
      AND symbol = $2
      AND signal = $3
      AND event_timestamp <= COALESCE($4::timestamp, NOW())
    `,
    [
      normalizedResult,
      signal.symbol || signal.asset || "UNKNOWN",
      signal.signal || signal.direction || "WAIT",
      signal.created_at || signal.createdAt || new Date()
    ]
  );

  return result.rowCount || 0;
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
        COUNT(*) FILTER (WHERE COALESCE(event_type, 'block') = 'block')::int AS blocked_signals,
        COUNT(*) FILTER (WHERE COALESCE(event_type, 'block') = 'penalty')::int AS penalized_signals,
        COUNT(DISTINCT filter_name)::int AS total_filters,
        COUNT(DISTINCT symbol)::int AS total_assets,
        COALESCE(AVG(final_score), 0)::numeric(10,2) AS avg_final_score,
        MAX(event_timestamp) AS last_block_at,
        COUNT(*) FILTER (
          WHERE COALESCE(final_score, 0) >=
            CASE
              WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 86
              WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 60
              ELSE 68
            END
        )::int AS shadow_approved_blocks
      FROM public.filter_block_events
    `),
    db.query(
      `
      SELECT
        filter_name AS "filterName",
        filter_label AS "filterLabel",
        COUNT(*) FILTER (WHERE COALESCE(event_type, 'block') = 'block')::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(event_type, 'block') = 'penalty')::int AS "penalties",
        COUNT(*) FILTER (WHERE result_outcome = 'win')::int AS "lostWins",
        COUNT(*) FILTER (WHERE result_outcome = 'loss')::int AS "savedLosses",
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
        COALESCE(event_type, 'block') AS "eventType",
        original_score AS "originalScore",
        result_outcome AS "resultOutcome",
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
  const penalizedSignals = Number(blockSummaryResult.rows[0]?.penalized_signals || 0);
  const totalSignals = approvedSignals + blockedSignals + penalizedSignals;
  const approvalRate = totalSignals
    ? Number(((approvedSignals / totalSignals) * 100).toFixed(2))
    : 0;
  const blockedRate = totalSignals
    ? Number(((blockedSignals / totalSignals) * 100).toFixed(2))
    : 0;
  const shadowApprovedBlocks = Number(blockSummaryResult.rows[0]?.shadow_approved_blocks || 0);
  const highConfidenceSignals = Number(filterResult.rows.reduce((total, row) => total + (Number(row.avgFinalScore || 0) >= 82 ? Number(row.penalties || 0) : 0), 0));
  const mediumConfidenceSignals = Math.max(0, approvedSignals - highConfidenceSignals);
  const watchlistSignals = penalizedSignals;
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
    penalizedSignals,
    penaltySignals: penalizedSignals,
    watchlistSignals,
    highConfidenceSignals,
    mediumConfidenceSignals,
    approvalRate,
    blockedRate,
    watchlistRate: totalSignals ? Number(((watchlistSignals / totalSignals) * 100).toFixed(2)) : 0,
    highConfidenceRate: totalSignals ? Number(((highConfidenceSignals / totalSignals) * 100).toFixed(2)) : 0,
    mediumConfidenceRate: totalSignals ? Number(((mediumConfidenceSignals / totalSignals) * 100).toFixed(2)) : 0,
    filterEfficiency,
    shadowMode: {
      wouldApproveBlockedSignals: shadowApprovedBlocks,
      blockedSignals,
      savedLosses: filterResult.rows.reduce((total, row) => total + Number(row.savedLosses || 0), 0),
      lostWins: filterResult.rows.reduce((total, row) => total + Number(row.lostWins || 0), 0),
      filterAccuracy: filterEfficiency,
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
      shadow_approved_blocks: shadowApprovedBlocks,
      total_penalties: penalizedSignals
    },
    ranking: filterResult.rows.map((row) => ({
      filter_name: row.filterName,
      filter_label: row.filterLabel,
      total_blocks: row.total,
      total_penalties: row.penalties || 0,
      saved_losses: row.savedLosses || 0,
      lost_wins: row.lostWins || 0,
      filter_accuracy: Number(row.total || 0) + Number(row.penalties || 0)
        ? Number(((Number(row.savedLosses || 0) / (Number(row.total || 0) + Number(row.penalties || 0))) * 100).toFixed(2))
        : 0,
      affected_assets: row.affectedAssets,
      avg_score: row.avgFinalScore,
      last_block_at: row.lastBlockAt
    })),
    recentBlocks: recentResult.rows
  };
}

module.exports = {
  recordBlockedSignal,
  recordSignalFilters,
  updateShadowOutcomes,
  getSummary,
  buildBlockEvents,
  buildFilterEvents
};
