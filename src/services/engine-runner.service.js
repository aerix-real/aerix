const marketData = require("./market-data.service");
const { runStrategies } = require("../strategy/strategy-runner.service");

const adaptiveService = require("./adaptive.service");
const autoTuningService = require("./auto-tuning.service");
const executionService = require("./execution.service");
const resultCheckerService = require("./result-checker.service");
const predictiveAiService = require("./predictive-ai.service");
const filterAnalyticsService = require("./filter-analytics.service");
const engineDebugService = require("./engine-debug.service");

const { analyzeIndicators } = require("./indicator-engine.service");
const { explainSignal, applyLossPenalty } = require("./signal-ai.service");
const { registerAudit } = require("./audit.service");
const RateLimiterService = require("./rate-limiter.service");

const signalRepository = require("../repositories/signal.repository");
const { emitToAll } = require("../websocket/socket");
const {
  isConfirmedOperationalSignal,
  filterConfirmedOperationalSignals
} = require("../utils/signal-history-filter");

const ECONOMIC_ENGINE_INTERVAL_MS = 5 * 60 * 1000;
const MIN_ANALYSIS_REVISIT_MS = Math.max(60 * 1000, Number(process.env.MIN_ANALYSIS_REVISIT_MS || ECONOMIC_ENGINE_INTERVAL_MS));
const RELEVANT_PRICE_CHANGE_PERCENT = Math.max(0, Number(process.env.RELEVANT_PRICE_CHANGE_PERCENT || 0.03));
const SNAPSHOT_REQUEST_COST = 3;

function logStructuredEngineError(event, error, context = {}) {
  console.error(JSON.stringify({
    scope: "aerix_engine_runner",
    event,
    timestamp: new Date().toISOString(),
    errorCode: error?.code || null,
    errorMessage: error?.message || String(error),
    ...context
  }));
}


function buildDirectionAbsenceReason(signal = {}) {
  const direction = signal.signal || signal.direction;

  if (["CALL", "PUT"].includes(direction)) return null;
  if (signal.blockReason || signal.block_reason) return signal.blockReason || signal.block_reason;
  if (signal.execution?.reason) return signal.execution.reason;
  if (Array.isArray(signal.blocks) && signal.blocks.length) return signal.blocks.join(" | ");
  if (Array.isArray(signal.reasons) && signal.reasons.length) return signal.reasons.join(" | ");
  if (direction === null) return "direction calculada como null.";
  if (direction === undefined) return "direction calculada como undefined.";
  if (direction === "WAIT") return "Sinal permaneceu WAIT sem bloco específico.";

  return "Direção CALL/PUT ausente sem motivo explícito.";
}

function emitEngineDirectionAudit(stage, signal = {}) {
  const indicators = signal.indicators || {};
  console.log(JSON.stringify({
    scope: "aerix_direction_audit",
    event: "engine_direction_pipeline",
    stage,
    timestamp: new Date().toISOString(),
    symbol: signal.symbol || signal.asset || "UNKNOWN",
    trendDirection: signal.trendDirection || signal.trend_direction || signal.mtf?.dominantDirection || "neutral",
    trendStrength: signal.trendStrength ?? signal.trend_strength ?? null,
    momentum: {
      m5MacdState: indicators.m5?.macd?.state || null,
      m15MacdState: indicators.m15?.macd?.state || null,
      h1MacdState: indicators.h1?.macd?.state || null
    },
    volatility: signal.volatility ?? null,
    marketRegime: signal.marketRegime || signal.market_regime || "NORMAL",
    finalScore: Number(signal.finalScore ?? signal.final_score ?? signal.score ?? 0),
    scoreBeforeAdaptiveAdjustment: signal.scoreBeforeAdaptiveAdjustment ?? signal.score_before_adaptive_adjustment ?? null,
    scoreAfterAdaptiveAdjustment: signal.scoreAfterAdaptiveAdjustment ?? signal.score_after_adaptive_adjustment ?? null,
    scoreUsedForApproval: signal.scoreUsedForApproval ?? signal.score_used_for_approval ?? signal.adjustedScore ?? signal.adjusted_score ?? null,
    minimumScore: signal.dynamicThresholds?.minimumScore ?? signal.dynamic_thresholds?.minimumScore ?? signal.minimumScore ?? signal.minimum_score ?? null,
    executionAllowedReason: signal.executionAllowedReason ?? signal.execution_allowed_reason ?? signal.execution?.reason ?? null,
    confidence: Number(signal.confidence ?? 0),
    calculatedDirection: signal.direction ?? signal.signal ?? null,
    signal: signal.signal ?? null,
    executionAllowed: signal.executionAllowed ?? signal.execution_allowed ?? signal.execution?.allowed ?? null,
    blockReason: signal.blockReason || signal.block_reason || signal.execution?.reason || null,
    directionAbsenceReason: buildDirectionAbsenceReason(signal),
    strategyName: signal.strategyName || signal.strategy_name || null,
    adaptiveAdjustment: signal.adaptiveAdjustment ?? signal.adaptive_adjustment ?? null,
    tuningWeight: signal.tuningWeight ?? signal.tuning_weight ?? null,
    dynamicThresholds: signal.dynamicThresholds || null
  }));
}

class EngineRunnerService {
  constructor() {
    this.running = false;
    this.isProcessing = false;
    this.interval = null;
    this.intervalMs = Number(process.env.ENGINE_INTERVAL_MS || ECONOMIC_ENGINE_INTERVAL_MS);

    this.symbols = String(process.env.SYMBOLS || process.env.DEFAULT_SYMBOLS || "EUR/USD,GBP/USD,USD/JPY,AUD/USD")
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);

    this.symbolCursor = 0;
    this.maxSymbolsPerCycle = Math.max(1, Number(process.env.MAX_SYMBOLS_PER_CYCLE || 1));
    this.maxConcurrentAnalyses = Math.max(1, Number(process.env.MAX_CONCURRENT_ANALYSES || 1));
    this.lastAnalysisBySymbol = new Map();

    this.bestOpportunity = null;
    this.latestResults = [];
    this.historyStats = {};
    this.lastCycleAt = null;
    this.lastStatus = "standby";
    this.startedAt = null;
    this.operationalStats = {
      day: new Date().toISOString().slice(0, 10),
      analyzedSignals: 0,
      approvedSignals: 0,
      lastExecutionAt: null
    };

    this.rateLimiter = new RateLimiterService({
      maxPerMinute: Number(process.env.MAX_REQUESTS_PER_MINUTE || 3)
    }, { cacheLatest: true });

    this.rateLimit = this.rateLimiter.getStats();
  }

  start() {
    if (this.running) return;

    console.log("🚀 Engine institucional iniciada...");
    this.running = true;
    this.lastStatus = "running";
    this.startedAt = new Date().toISOString();

    this.runCycle();

    this.interval = setInterval(() => {
      this.runCycle();
    }, this.intervalMs);
  }

  stop() {
    this.running = false;
    this.lastStatus = "stopped";

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  resetOperationalStatsIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);

    if (this.operationalStats.day === today) return;

    this.operationalStats = {
      day: today,
      analyzedSignals: 0,
      approvedSignals: 0,
      lastExecutionAt: null
    };
  }

  recordOperationalAnalysis(result = {}) {
    this.resetOperationalStatsIfNeeded();
    this.operationalStats.analyzedSignals += 1;
    this.operationalStats.lastExecutionAt = new Date().toISOString();

    if (isConfirmedOperationalSignal(result)) {
      this.operationalStats.approvedSignals += 1;
    }
  }

  getEngineUptimeMs() {
    if (!this.running || !this.startedAt) return 0;

    const startedAtMs = new Date(this.startedAt).getTime();
    if (!Number.isFinite(startedAtMs)) return 0;

    return Math.max(0, Date.now() - startedAtMs);
  }

  getOperationalMonitor() {
    this.resetOperationalStatsIfNeeded();

    const twelveData = typeof marketData.buildTwelveDataOperationalMetrics === "function"
      ? marketData.buildTwelveDataOperationalMetrics()
      : null;

    return {
      status: this.lastStatus,
      isRunning: this.running,
      isProcessing: this.isProcessing,
      startedAt: this.startedAt,
      uptimeMs: this.getEngineUptimeMs(),
      uptimeSeconds: Math.floor(this.getEngineUptimeMs() / 1000),
      twelveDataRequestsToday: twelveData?.requestsToday || 0,
      twelveDataDailyBudget: twelveData?.dailyBudget || null,
      cacheHitRate: twelveData?.cacheHitRate || 0,
      cacheHits: twelveData?.cacheHits || 0,
      cacheTotalLookups: twelveData?.totalLookups || 0,
      analyzedSignals: this.operationalStats.analyzedSignals,
      approvedSignals: this.operationalStats.approvedSignals,
      lastExecutionAt: this.operationalStats.lastExecutionAt || this.lastCycleAt,
      lastCycleAt: this.lastCycleAt,
      day: this.operationalStats.day
    };
  }

  getState() {
    return {
      isRunning: this.running,
      isProcessing: this.isProcessing,
      bestOpportunity: this.bestOpportunity,
      latestResults: this.latestResults,
      historyStats: this.historyStats,
      rateLimit: this.rateLimit,
      trackedSymbols: this.symbols,
      lastCycleAt: this.lastCycleAt,
      lastStatus: this.lastStatus,
      intervalMs: this.intervalMs,
      economicMode: {
        enabled: true,
        minAnalysisRevisitMs: MIN_ANALYSIS_REVISIT_MS,
        maxSymbolsPerCycle: this.maxSymbolsPerCycle,
        maxConcurrentAnalyses: this.maxConcurrentAnalyses,
        relevantPriceChangePercent: RELEVANT_PRICE_CHANGE_PERCENT
      },
      operationalMonitor: this.getOperationalMonitor(),
      twelveDataConsumption: typeof marketData.buildTwelveDataConsumptionReport === "function"
        ? marketData.buildTwelveDataConsumptionReport({
            symbols: this.symbols,
            intervalMs: this.intervalMs,
            maxSymbolsPerCycle: this.maxSymbolsPerCycle
          })
        : null
    };
  }

  getCurrentMode() {
    const mode = String(process.env.TRADING_MODE || process.env.MODE || "balanced").toLowerCase();

    if (["conservador", "conservative"].includes(mode)) return "conservative";
    if (["agressivo", "aggressive"].includes(mode)) return "aggressive";

    return "balanced";
  }

  getNextSymbols() {
    const selected = [];

    if (!this.symbols.length) {
      return selected;
    }

    const cycleLimit = Math.min(this.maxSymbolsPerCycle, this.maxConcurrentAnalyses);

    for (let i = 0; i < cycleLimit; i += 1) {
      const symbol = this.symbols[this.symbolCursor % this.symbols.length];
      selected.push(symbol);
      this.symbolCursor += 1;
    }

    return selected;
  }

  isSniperMoment() {
    const now = new Date();
    const seconds = now.getSeconds();

    return seconds >= 55 || seconds <= 5;
  }

  applySniperTiming(signal) {
    const score = Number(signal.finalScore || signal.confidence || 0);
    const direction = String(signal.signal || "").toUpperCase();
    const sniperThreshold = Number(signal.dynamicThresholds?.sniperTiming || signal.sniperTiming || 90);

    if (!["CALL", "PUT"].includes(direction)) {
      return signal;
    }

    if (score >= sniperThreshold) {
      return {
        ...signal,
        timing: "ENTRAR AGORA",
        timing_mode: "SNIPER_FORTE",
        timing_confidence: 100
      };
    }

    if (!this.isSniperMoment()) {
      const penalty = signal.mode === "aggressive" ? 4 : signal.mode === "balanced" ? 6 : 10;
      const adjustedScore = Math.max(0, score - penalty);
      const extremeTimingFloor = signal.mode === "aggressive"
        ? Math.max(42, sniperThreshold - 38)
        : signal.mode === "balanced"
          ? Math.max(48, sniperThreshold - 34)
          : Math.max(58, sniperThreshold - 22);
      const timingSignal = {
        ...signal,
        finalScore: adjustedScore,
        final_score: adjustedScore,
        adjustedScore,
        adjusted_score: adjustedScore,
        timing: "AGUARDANDO VIRADA DA VELA",
        timing_mode: "SNIPER_WAIT_SCORE_PENALTY",
        timing_confidence: Math.max(40, 75 - penalty),
        reasons: [
          ...(signal.reasons || []),
          `Fora da janela sniper: score reduzido em ${penalty} pontos.`
        ]
      };

      this.appendFilterPenalty(
        timingSignal,
        "sniper_block",
        `Fora da janela ideal sniper: score/confiança reduzidos em ${penalty} pontos.`,
        { score, finalScore: adjustedScore, originalScore: score }
      );

      if (adjustedScore < extremeTimingFloor) {
        const blockedSignal = {
          ...timingSignal,
          blocked: true,
          signal: "WAIT",
          direction: "WAIT",
          blockReason: signal.blockReason || "Cenário sniper extremamente ruim fora da janela de entrada",
          block_reason: signal.blockReason || "Cenário sniper extremamente ruim fora da janela de entrada",
          blocks: [
            ...(signal.blocks || []),
            "Cenário sniper extremamente ruim fora da janela de entrada"
          ]
        };

        return this.appendFilterBlock(
          blockedSignal,
          "sniper_block",
          "Cenário sniper extremamente ruim fora da janela de entrada"
        );
      }

      return timingSignal;
    }

    return {
      ...signal,
      timing: "ENTRAR AGORA",
      timing_mode: "SNIPER_OK",
      timing_confidence: 95
    };
  }

  appendFilterPenalty(signal, filterName, reason, extra = {}) {
    const event = {
      filterName,
      reason: reason || "Penalidade institucional aplicada ao score.",
      symbol: signal.symbol || signal.asset,
      score: Number(extra.score ?? signal.score ?? signal.confidence ?? 0),
      finalScore: Number(extra.finalScore ?? signal.finalScore ?? signal.final_score ?? signal.adjustedScore ?? 0),
      originalScore: Number(extra.originalScore ?? signal.confidence ?? signal.score ?? 0),
      signal: extra.signal || signal.originalSignal || signal.directionBeforeBlock || signal.signal || signal.direction,
      strategyName: signal.strategyName || signal.strategy_name || signal.strategy,
      timestamp: new Date().toISOString(),
      eventType: "penalty"
    };

    signal.filterPenalties = [...(signal.filterPenalties || []), event];

    return signal;
  }

  appendFilterBlock(signal, filterName, reason, extra = {}) {
    const blockReason = reason || signal.blockReason || signal.block_reason || "Bloqueio institucional sem motivo detalhado.";
    const event = {
      filterName,
      reason: blockReason,
      symbol: signal.symbol || signal.asset,
      score: Number(extra.score ?? signal.score ?? signal.confidence ?? 0),
      finalScore: Number(extra.finalScore ?? signal.finalScore ?? signal.final_score ?? signal.adjustedScore ?? 0),
      signal: extra.signal || signal.originalSignal || signal.directionBeforeBlock || signal.signal || signal.direction,
      strategyName: signal.strategyName || signal.strategy_name || signal.strategy,
      timestamp: new Date().toISOString()
    };

    signal.filterBlocks = [...(signal.filterBlocks || []), event];

    if (!signal.blocks?.includes(blockReason)) {
      signal.blocks = [...(signal.blocks || []), blockReason];
    }

    return signal;
  }

  buildPredictiveBlockedSignal({ symbol, mode, predictiveDecision }) {
    return this.normalizeForDatabase({
      symbol,
      asset: symbol,
      signal: "WAIT",
      direction: "WAIT",
      confidence: 0,
      finalScore: predictiveDecision.preScore || 0,
      final_score: predictiveDecision.preScore || 0,
      adjustedScore: predictiveDecision.preScore || 0,
      adjusted_score: predictiveDecision.preScore || 0,
      strategyName: "predictive_ai_gate",
      strategy_name: "predictive_ai_gate",
      entryQuality: "blocked",
      entry_quality: "blocked",
      institutionalQuality: "pre_signal_block",
      institutional_quality: "pre_signal_block",
      mode,
      blocked: true,
      blockReason: predictiveDecision.explanation || "IA preditiva bloqueou antes do sinal.",
      block_reason: predictiveDecision.explanation || "IA preditiva bloqueou antes do sinal.",
      explanation: predictiveDecision.explanation || "IA preditiva bloqueou antes do sinal.",
      timing: "BLOQUEADO ANTES DO SINAL",
      timing_mode: "PREDICTIVE_AI_BLOCK",
      timing_confidence: predictiveDecision.preScore || 0,
      market_regime: "PREDICTIVE_AI_BLOCK",
      reasons: predictiveDecision.reasons || [],
      blocks: predictiveDecision.risks?.length
        ? predictiveDecision.risks
        : [predictiveDecision.explanation || "IA preditiva bloqueou antes do sinal."],
      filterBlocks: [
        {
          filterName: "predictive_ai_block",
          reason: predictiveDecision.explanation || "IA preditiva bloqueou antes do sinal.",
          score: predictiveDecision.preScore || 0,
          finalScore: predictiveDecision.preScore || 0,
          strategyName: "predictive_ai_gate"
        }
      ],
      predictiveAi: predictiveDecision,
      predictive_ai: predictiveDecision,
      preSignalScore: predictiveDecision.preScore || 0,
      pre_signal_score: predictiveDecision.preScore || 0,
      result: "pending"
    });
  }

  getSnapshotSignature(snapshot = {}) {
    const lastM5 = this.getLastM5Candle(snapshot);
    const h1 = snapshot?.timeframes?.h1 || {};
    const m15 = snapshot?.timeframes?.m15 || {};

    if (!lastM5) return null;

    return {
      candleTime: lastM5.datetime || lastM5.time || null,
      close: Number(lastM5.close || 0),
      h1Direction: h1.direction || "neutral",
      m15Direction: m15.direction || "neutral",
      h1Strength: Number(h1.strengthPercent || 0),
      m15Strength: Number(m15.strengthPercent || 0)
    };
  }

  hasRelevantSnapshotChange(previousSignature, nextSignature) {
    if (!previousSignature || !nextSignature) return true;

    if (previousSignature.candleTime !== nextSignature.candleTime) return true;
    if (previousSignature.h1Direction !== nextSignature.h1Direction) return true;
    if (previousSignature.m15Direction !== nextSignature.m15Direction) return true;

    const previousClose = Number(previousSignature.close || 0);
    const nextClose = Number(nextSignature.close || 0);
    const priceChangePercent = previousClose
      ? Math.abs(((nextClose - previousClose) / previousClose) * 100)
      : 0;

    return priceChangePercent >= RELEVANT_PRICE_CHANGE_PERCENT;
  }

  shouldSkipRecentlyAnalyzed(symbol) {
    const previous = this.lastAnalysisBySymbol.get(symbol);
    if (!previous?.analyzedAt) return false;

    return Date.now() - previous.analyzedAt < MIN_ANALYSIS_REVISIT_MS;
  }

  buildCachedAnalysisResult(symbol, previous, reason) {
    if (!previous?.result) return null;

    return {
      ...previous.result,
      symbol,
      asset: previous.result.asset || symbol,
      cachedAnalysis: true,
      economicMode: {
        reused: true,
        reason,
        analyzedAt: new Date(previous.analyzedAt).toISOString(),
        minAnalysisRevisitMs: MIN_ANALYSIS_REVISIT_MS,
        relevantPriceChangePercent: RELEVANT_PRICE_CHANGE_PERCENT
      },
      timestamp: new Date().toISOString()
    };
  }

  rememberAnalysis(symbol, snapshot, result) {
    this.lastAnalysisBySymbol.set(symbol, {
      analyzedAt: Date.now(),
      signature: this.getSnapshotSignature(snapshot),
      result
    });
  }

  applyPredictiveDecisionToSignal(signal, predictiveDecision) {
    const scoreAdjustment = Number(predictiveDecision.scoreAdjustment || 0);
    const finalScore = Math.max(0, Math.min(100, Number(signal.finalScore || 0) + scoreAdjustment));

    return {
      ...signal,
      finalScore,
      final_score: finalScore,
      scoreBeforeAdaptiveAdjustment: finalScore,
      predictiveAi: predictiveDecision,
      predictive_ai: predictiveDecision,
      preSignalScore: predictiveDecision.preScore || 0,
      pre_signal_score: predictiveDecision.preScore || 0,
      preSignalScoreAdjustment: scoreAdjustment,
      pre_signal_score_adjustment: scoreAdjustment,
      reasons: [
        ...(signal.reasons || []),
        ...(predictiveDecision.reasons || []),
        ...(predictiveDecision.moderateRisks || []).map((risk) => `Predictive AI penalizou score: ${risk}`)
      ],
      blocks: predictiveDecision.blocked
        ? [...(signal.blocks || []), ...(predictiveDecision.severeRisks || predictiveDecision.risks || [])]
        : [...(signal.blocks || [])],
      adaptiveReasons: [
        ...(signal.adaptiveReasons || []),
        `Pre-score IA: ${predictiveDecision.preScore || 0}%`,
        `Ajuste Predictive AI: ${scoreAdjustment}`
      ],
      explanation: signal.explanation
        ? `${signal.explanation} ${predictiveDecision.explanation || ""}`.trim()
        : predictiveDecision.explanation || signal.explanation
    };
  }

  async runCycle() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    const cycleResults = [];

    try {
      const mode = this.getCurrentMode();
      const symbolsToProcess = this.getNextSymbols();

      for (const symbol of symbolsToProcess) {
        try {
          const previousAnalysis = this.lastAnalysisBySymbol.get(symbol);

          if (this.shouldSkipRecentlyAnalyzed(symbol)) {
            const cachedResult = this.buildCachedAnalysisResult(
              symbol,
              previousAnalysis,
              "recently_analyzed"
            );

            if (cachedResult) {
              cycleResults.push(cachedResult);
              this.recordOperationalAnalysis(cachedResult);
              continue;
            }
          }

          if (!this.rateLimiter.canProceed(SNAPSHOT_REQUEST_COST)) {
            this.rateLimit = this.rateLimiter.getStats();
            console.log(
              `⏸ Rate limit protegido: aguardando janela. Uso ${this.rateLimit.usedInCurrentWindow}/${this.rateLimit.maxPerMinute}`
            );
            continue;
          }

          this.rateLimiter.register(SNAPSHOT_REQUEST_COST);
          this.rateLimit = this.rateLimiter.getStats();

          const snapshot = await marketData.getMarketSnapshot(symbol);
          const nextSignature = this.getSnapshotSignature(snapshot);

          if (
            previousAnalysis?.result &&
            !this.hasRelevantSnapshotChange(previousAnalysis.signature, nextSignature)
          ) {
            const cachedResult = this.buildCachedAnalysisResult(
              symbol,
              previousAnalysis,
              "no_relevant_market_change"
            );

            if (cachedResult) {
              this.lastAnalysisBySymbol.set(symbol, {
                ...previousAnalysis,
                analyzedAt: Date.now(),
                signature: nextSignature
              });
              cycleResults.push(cachedResult);
              this.recordOperationalAnalysis(cachedResult);
              continue;
            }
          }

          const indicators = this.buildIndicators(snapshot, mode);

          const predictiveDecision = await predictiveAiService.evaluatePreSignal({
            symbol,
            snapshot,
            mode
          });

          if (predictiveDecision.blocked) {
            const blockedSignal = this.buildPredictiveBlockedSignal({
              symbol,
              mode,
              predictiveDecision
            });

            cycleResults.push(blockedSignal);
            this.recordOperationalAnalysis(blockedSignal);
            this.rememberAnalysis(symbol, snapshot, blockedSignal);
            engineDebugService.recordAnalyzed(blockedSignal, {
              source: "engine_runner",
              stage: "predictive_ai_pre_check"
            });
            engineDebugService.recordBlocked(blockedSignal, {
              source: "engine_runner",
              stage: "predictive_ai_pre_check",
              filterName: "predictive_ai_block",
              blockReason: blockedSignal.blockReason || blockedSignal.block_reason
            });
            this.emitBlocked(blockedSignal);
            await this.recordFilterAnalytics(blockedSignal, "predictive_ai");

            await this.auditDecision("predictive_ai_pre_block", blockedSignal);
            continue;
          }

          const strategyResult = runStrategies({
            snapshot,
            mode
          });

          let signal = this.buildSignalPayload({
            symbol,
            snapshot,
            indicators,
            strategyResult,
            mode
          });

          emitEngineDirectionAudit("after_strategy_payload", signal);

          signal = this.applyPredictiveDecisionToSignal(signal, predictiveDecision);
          signal = await this.applyAdaptiveLayers(signal);
          signal = applyLossPenalty(signal, this.latestResults);
          signal = this.applySniperTiming(signal);
          signal = this.applyExecutionValidation(signal);
          emitEngineDirectionAudit("after_execution_validation", signal);
          signal = this.normalizeForDatabase(signal);

          cycleResults.push(signal);
          this.recordOperationalAnalysis(signal);
          this.rememberAnalysis(symbol, snapshot, signal);
          engineDebugService.recordFinalDecision(signal, {
            source: "engine_runner",
            stage: "post_execution_validation"
          });

          if (signal.blocked || signal.signal === "WAIT") {
            this.emitBlocked(signal);
            await this.recordFilterAnalytics(signal, "engine");
            await this.auditDecision("signal_blocked", signal);
            continue;
          }

          if (!isConfirmedOperationalSignal(signal)) {
            await this.auditDecision("signal_discarded_unconfirmed", signal);
            continue;
          }

          const saved = await this.persistGeneratedSignal(signal);
          signal.id = saved?.id || signal.id;

          this.bestOpportunity = signal;
          this.latestResults = [signal, ...this.latestResults].slice(0, 30);

          emitToAll("signal", signal, { cacheLatest: true });
          emitToAll("bestOpportunity", signal, { cacheLatest: true });

          await this.auditDecision("signal_generated", signal);
        } catch (symbolError) {
          console.error(`Erro ao processar ${symbol}:`, symbolError.message || symbolError);
          engineDebugService.recordFinalDecision({
            symbol,
            signal: "WAIT",
            confidence: 0,
            finalScore: 0,
            blocked: true,
            blockReason: symbolError.message || "Erro ao processar símbolo.",
            marketRegime: "ERROR"
          }, {
            source: "engine_runner",
            stage: "symbol_cycle_error",
            filterName: "engine_error",
            blockReason: symbolError.message || "Erro ao processar símbolo."
          });

          await this.auditDecision("symbol_cycle_error", {
            symbol,
            error: symbolError.message || String(symbolError)
          });
        }
      }

      await this.checkResults();

      this.lastCycleAt = new Date().toISOString();
      this.lastStatus = "running";

      await this.refreshStats();

      this.emitRuntimeUpdate(cycleResults);
    } catch (error) {
      console.error("Erro no ciclo:", error.message || error);
      this.lastStatus = "error";
    } finally {
      this.isProcessing = false;
      this.rateLimit = this.rateLimiter.getStats();
    }
  }

  buildIndicators(snapshot, mode) {
    const h1Candles = snapshot?.timeframes?.h1?.candles || [];
    const m15Candles = snapshot?.timeframes?.m15?.candles || [];
    const m5Candles = snapshot?.timeframes?.m5?.candles || [];

    return {
      h1: analyzeIndicators(h1Candles, mode),
      m15: analyzeIndicators(m15Candles, mode),
      m5: analyzeIndicators(m5Candles, mode)
    };
  }

  getLastM5Candle(snapshot) {
    const candles = snapshot?.timeframes?.m5?.candles || [];
    return candles[candles.length - 1] || null;
  }

  buildTiming(signal) {
    const score = Number(signal.finalScore || signal.confidence || 0);
    const sniperThreshold = Number(signal.dynamicThresholds?.sniperTiming || signal.sniperTiming || 88);
    const prepareThreshold = Math.max(70, sniperThreshold - 10);

    if (score >= sniperThreshold) return "ENTRAR AGORA";
    if (score >= prepareThreshold) return "PREPARAR ENTRADA";

    return "AGUARDANDO";
  }

  buildSignalPayload({ symbol, snapshot, indicators, strategyResult, mode }) {
    const now = new Date();
    const expiryMinutes = Number(process.env.EXPIRATION_MINUTES || 1);
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);
    const lastM5 = this.getLastM5Candle(snapshot);

    const finalScore = Number(strategyResult.finalScore || strategyResult.confidence || 0);
    const signalDirection = strategyResult.signal || "WAIT";
    const isFallbackSignal = strategyResult.marketRegime === "FALLBACK_SIGNAL";
    const fallbackBlocked = Boolean(snapshot?.isFallback) && !isFallbackSignal;

    const baseSignal = {
      symbol,
      asset: symbol,
      signal: signalDirection,
      direction: signalDirection,
      confidence: Number(strategyResult.confidence || 0),
      finalScore,
      final_score: finalScore,
      strategyName: strategyResult.strategyName || "multi_strategy",
      strategy_name: strategyResult.strategyName || "multi_strategy",
      entryQuality: strategyResult.entryQuality || "weak",
      entry_quality: strategyResult.entryQuality || "weak",
      institutionalQuality: strategyResult.entryQuality || "weak",
      institutional_quality: strategyResult.entryQuality || "weak",
      reasons: Array.isArray(strategyResult.reasons) ? strategyResult.reasons : [],
      activationReason: strategyResult.activationReason || null,
      blocks: Array.isArray(strategyResult.blocks) ? strategyResult.blocks : [],
      strategies: strategyResult.strategies || [],
      metrics: strategyResult.metrics || {},
      mtf: strategyResult.mtf || {},
      market: snapshot?.timeframes || {},
      dataQuality: snapshot?.dataQuality || {
        source: snapshot?.source || "unknown",
        isFallback: Boolean(snapshot?.isFallback),
        operational: !snapshot?.isFallback
      },
      data_quality: snapshot?.dataQuality || {
        source: snapshot?.source || "unknown",
        isFallback: Boolean(snapshot?.isFallback),
        operational: !snapshot?.isFallback
      },
      indicators,
      mode,
      trendDirection: snapshot?.timeframes?.h1?.direction || "neutral",
      trend_direction: snapshot?.timeframes?.h1?.direction || "neutral",
      trendStrength: Number(snapshot?.timeframes?.h1?.strengthPercent || 0),
      trend_strength: Number(snapshot?.timeframes?.h1?.strengthPercent || 0),
      volatility: Number(snapshot?.timeframes?.m5?.volatilityPercent || 0),
      marketRegime: strategyResult.marketRegime || this.detectMarketRegime(snapshot),
      market_regime: strategyResult.marketRegime || this.detectMarketRegime(snapshot),
      entry_price: lastM5?.close ?? null,
      price: lastM5?.close ?? null,
      expires_at: expiresAt.toISOString(),
      expiry: expiresAt.toISOString(),
      expiration: expiresAt.toISOString(),
      created_at: now.toISOString(),
      result: "pending",
      blocked: Boolean(strategyResult.blocked || fallbackBlocked),
      blockReason: strategyResult.blockReason || (fallbackBlocked
        ? "Fonte de dados em fallback; entrada operacional bloqueada."
        : null),
      block_reason: strategyResult.blockReason || (fallbackBlocked
        ? "Fonte de dados em fallback; entrada operacional bloqueada."
        : null)
    };

    baseSignal.timing = this.buildTiming(baseSignal);

    baseSignal.explanation = explainSignal({
      symbol,
      signal: baseSignal.signal,
      confidence: baseSignal.confidence,
      reasons: baseSignal.reasons,
      modeConfig: {
        label: mode,
        minimumConfidence: mode === "conservative" ? 78 : mode === "aggressive" ? 61 : 68
      }
    });

    return baseSignal;
  }

  async applyAdaptiveLayers(signal) {
    const scoreBeforeAdaptiveAdjustment = Number(signal.finalScore || signal.confidence || 0);
    signal.scoreBeforeAdaptiveAdjustment = Number(
      signal.scoreBeforeAdaptiveAdjustment ?? scoreBeforeAdaptiveAdjustment
    );

    const adaptive = await adaptiveService.applyAdaptiveScore(
      scoreBeforeAdaptiveAdjustment,
      signal
    );

    signal.scoreAfterAdaptiveAdjustment = Number(adaptive.finalScore || signal.finalScore || 0);
    signal.finalScore = Number(adaptive.finalScore || signal.finalScore || 0);
    signal.final_score = signal.finalScore;
    signal.adaptiveAdjustment = Number(adaptive.adaptiveAdjustment || 0);
    signal.adaptive_adjustment = signal.adaptiveAdjustment;
    signal.adaptiveReasons = adaptive.adaptiveReasons || [];
    signal.adaptiveAdjustments = {
      adjustment: signal.adaptiveAdjustment,
      reasons: signal.adaptiveReasons,
      audit: adaptive.adaptiveAdjustmentAudit,
      profile: adaptive.learningProfile
    };
    signal.dynamicThresholds = adaptive.dynamicThresholds || signal.dynamicThresholds || null;
    signal.thresholdHistory = signal.dynamicThresholds?.thresholdHistory || null;
    signal.thresholdChanges = signal.dynamicThresholds?.thresholdChanges || [];
    signal.thresholdPerformance = signal.dynamicThresholds?.thresholdPerformance || null;
    signal.learningProfile = adaptive.learningProfile || null;

    const hardBlock = await adaptiveService.shouldHardBlock(signal);

    if (hardBlock?.blocked) {
      signal.blocked = true;
      signal.blockReason = hardBlock.reason || "Bloqueado pela IA adaptativa";
      signal.block_reason = signal.blockReason;
      this.appendFilterBlock(signal, "adaptive_block", signal.blockReason);
    }

    const tuning = await autoTuningService.applyAutoTuning(signal);

    signal.finalScore = Number(tuning.tunedScore || signal.finalScore || 0);
    signal.final_score = signal.finalScore;
    signal.tuningWeight = Number(tuning.tuningWeight || 1);
    signal.tuning_weight = signal.tuningWeight;
    signal.tuningReasons = tuning.tuningReasons || [];
    signal.tuningProfile = tuning.tuningProfile || null;
    signal.dynamicThresholds = tuning.dynamicThresholds || signal.dynamicThresholds || null;
    signal.thresholdHistory = signal.dynamicThresholds?.thresholdHistory || signal.thresholdHistory || null;
    signal.thresholdChanges = signal.dynamicThresholds?.thresholdChanges || signal.thresholdChanges || [];
    signal.thresholdPerformance = signal.dynamicThresholds?.thresholdPerformance || signal.thresholdPerformance || null;

    signal.timing = this.buildTiming(signal);

    const minimumScore = Number(
      signal.dynamicThresholds?.minimumScore ??
      (signal.mode === "conservative"
        ? 78
        : signal.mode === "aggressive"
          ? 61
          : 68)
    );

    const tolerance = signal.mode === "aggressive" ? 10 : signal.mode === "balanced" ? 6 : 0;
    const scoreGap = minimumScore - signal.finalScore;

    if (scoreGap > tolerance) {
      signal.blocked = true;
      signal.blockReason =
        signal.blockReason || "Score abaixo do mínimo institucional após auto tuning";
      signal.block_reason = signal.blockReason;
      signal.signal = "WAIT";
      signal.direction = "WAIT";
      this.appendFilterBlock(
        signal,
        "low_score_block",
        `Score abaixo do mínimo institucional após auto tuning (${signal.finalScore.toFixed(1)} < ${minimumScore})`,
        {
          score: signal.confidence,
          finalScore: signal.finalScore
        }
      );
    } else if (scoreGap > 0) {
      signal.reasons = [
        ...(signal.reasons || []),
        `Score abaixo do mínimo aprendido tratado como penalidade em ${signal.mode} (${signal.finalScore.toFixed(1)} < ${minimumScore}).`
      ];
      signal.dynamicThresholdPenalty = true;
    }

    return signal;
  }

  applyExecutionValidation(signal) {
    const validation = executionService.validate(signal);

    signal.execution = validation;
    signal.executionAllowed = validation.allowed;
    signal.execution_allowed = validation.allowed;
    signal.minimumScore = validation.minimumScore || executionService.getMinimumScoreByMode(signal);
    signal.minimum_score = signal.minimumScore;
    signal.adjustedScore = validation.adjustedScore ?? signal.finalScore;
    signal.adjusted_score = signal.adjustedScore;
    signal.scoreUsedForApproval = Number(signal.adjustedScore ?? signal.finalScore ?? 0);
    signal.executionAllowedReason = validation.reason || null;
    signal.aiAdjustments = validation.aiAdjustments || signal.aiAdjustments || null;
    signal.aiBlock = validation.aiBlock || signal.aiBlock || null;

    if (Array.isArray(validation.aiPenaltyReasons) && validation.aiPenaltyReasons.length) {
      signal.reasons = [
        ...(signal.reasons || []),
        ...validation.aiPenaltyReasons
      ];
      signal.antiLoss = {
        ...(signal.antiLoss || {}),
        blocked: false,
        penaltyReasons: validation.aiPenaltyReasons
      };

      validation.aiPenaltyReasons.forEach((reason) => {
        this.appendFilterPenalty(signal, "anti_loss_penalty", reason, {
          score: signal.confidence,
          finalScore: signal.adjustedScore
        });
      });
    }

    if (!validation.allowed) {
      signal.blocked = true;
      signal.blockReason =
        validation.reason || signal.blockReason || "Bloqueado pela validação operacional";
      signal.block_reason = signal.blockReason;
      this.appendFilterBlock(signal, "execution_block", signal.blockReason, {
        finalScore: validation.adjustedScore ?? signal.finalScore
      });
    }

    return signal;
  }

  detectMarketRegime(snapshot) {
    const m5Volatility = Number(snapshot?.timeframes?.m5?.volatilityPercent || 0);
    const h1Strength = Number(snapshot?.timeframes?.h1?.strengthPercent || 0);
    const m15Strength = Number(snapshot?.timeframes?.m15?.strengthPercent || 0);

    if (m5Volatility < 0.12) return "MERCADO LATERAL / BAIXA VOLATILIDADE";
    if (m5Volatility >= 0.6) return "ALTA VOLATILIDADE";
    if (h1Strength >= 0.4 && m15Strength >= 0.25) return "TENDÊNCIA FORTE";

    return "NORMAL";
  }

  normalizeForDatabase(signal) {
    const finalScore = Number(
      signal.finalScore || signal.final_score || signal.score || signal.confidence || 0
    );

    const strategyName =
      signal.strategyName ||
      signal.strategy_name ||
      signal.strategy ||
      "multi_strategy";

    const quality =
      signal.institutionalQuality ||
      signal.institutional_quality ||
      signal.entryQuality ||
      signal.entry_quality ||
      "weak";

    const blockReason = signal.blockReason || signal.block_reason || null;

    return {
      ...signal,
      user_id: signal.user_id ?? null,

      symbol: signal.symbol || signal.asset || "UNKNOWN",

      signal: signal.signal || signal.direction || "WAIT",
      direction: signal.direction || signal.signal || "WAIT",

      confidence: Number(signal.confidence || finalScore),
      finalScore,
      final_score: finalScore,

      adjustedScore: Number(signal.adjustedScore || signal.adjusted_score || finalScore),
      adjusted_score: Number(signal.adjustedScore || signal.adjusted_score || finalScore),

      strategyName,
      strategy_name: strategyName,

      institutionalQuality: quality,
      institutional_quality: quality,
      entryQuality: quality,
      entry_quality: quality,

      blocked: Boolean(signal.blocked),
      blockReason,
      block_reason: blockReason,
      executionAllowed: signal.executionAllowed === true || signal.execution_allowed === true,
      execution_allowed: signal.executionAllowed === true || signal.execution_allowed === true,
      minimumScore: Number(signal.minimumScore || signal.minimum_score || 0),
      minimum_score: Number(signal.minimumScore || signal.minimum_score || 0),
      scoreBeforeAdaptiveAdjustment: Number(signal.scoreBeforeAdaptiveAdjustment ?? finalScore),
      scoreAfterAdaptiveAdjustment: Number(signal.scoreAfterAdaptiveAdjustment ?? finalScore),
      scoreUsedForApproval: Number(signal.scoreUsedForApproval ?? signal.adjustedScore ?? signal.adjusted_score ?? finalScore),
      executionAllowedReason: signal.executionAllowedReason || signal.execution?.reason || blockReason,

      explanation: signal.explanation || "",
      activationReason: signal.activationReason || null,
      timing: signal.timing || "AGUARDANDO",
      entry_in_seconds: Number(signal.entry_in_seconds || signal.entryInSeconds || 0),
      entryInSeconds: Number(signal.entryInSeconds || signal.entry_in_seconds || 0),
      timing_mode: signal.timing_mode || signal.timingMode || null,
      timing_confidence: signal.timing_confidence ?? signal.timingConfidence ?? null,

      dynamicThresholds: signal.dynamicThresholds || null,
      thresholdHistory: signal.thresholdHistory || null,
      thresholdChanges: signal.thresholdChanges || [],
      thresholdPerformance: signal.thresholdPerformance || null,

      market_regime: signal.market_regime || signal.marketRegime || "NORMAL",
      dataQuality: signal.dataQuality || signal.data_quality || null,
      data_quality: signal.data_quality || signal.dataQuality || null,

      adaptive_adjustment: Number(signal.adaptiveAdjustment || signal.adaptive_adjustment || 0),
      adaptiveAdjustment: Number(signal.adaptiveAdjustment || signal.adaptive_adjustment || 0),

      tuning_weight: Number(signal.tuningWeight || signal.tuning_weight || 1),
      tuningWeight: Number(signal.tuningWeight || signal.tuning_weight || 1),

      mode: signal.mode || "balanced",
      trend_direction: signal.trend_direction || signal.trendDirection || "neutral",
      trendDirection: signal.trendDirection || signal.trend_direction || "neutral",

      trend_strength: Number(signal.trend_strength || signal.trendStrength || 0),
      trendStrength: Number(signal.trendStrength || signal.trend_strength || 0),

      volatility: Number(signal.volatility || 0),

      entry_price: signal.entry_price ?? signal.entryPrice ?? signal.price ?? null,
      price: signal.price ?? signal.entry_price ?? signal.entryPrice ?? null,

      expires_at: signal.expires_at ?? signal.expiry ?? signal.expiration ?? null,
      expiry: signal.expiry ?? signal.expires_at ?? signal.expiration ?? null,
      expiration: signal.expiration ?? signal.expires_at ?? signal.expiry ?? null,

      result: signal.result || "pending"
    };
  }


  async persistGeneratedSignal(signal) {
    try {
      return await signalRepository.insertSignal(signal);
    } catch (error) {
      logStructuredEngineError("signal_persistence_failed", error, {
        table: "signal_history",
        symbol: signal.symbol || signal.asset || "UNKNOWN",
        signal: signal.signal || signal.direction || "WAIT",
        executionAllowed: signal.executionAllowed ?? signal.execution_allowed ?? null,
        nonBlocking: true
      });

      await this.auditDecision("signal_persistence_failed", {
        symbol: signal.symbol || signal.asset || "UNKNOWN",
        signal: signal.signal || signal.direction || "WAIT",
        executionAllowed: signal.executionAllowed ?? signal.execution_allowed ?? null,
        error: error.message || String(error)
      });

      return null;
    }
  }

  async recordFilterAnalytics(signal, source = "engine") {
    try {
      await filterAnalyticsService.recordSignalFilters(signal, source);
    } catch (error) {
      console.error("Erro ao registrar analytics de bloqueio:", error.message || error);
    }
  }

  async checkResults() {
    try {
      const updated = await resultCheckerService.checkPendingSignals();

      if (updated.length) {
        emitToAll("history", filterConfirmedOperationalSignals(updated), { cacheLatest: true });

        await this.auditDecision("results_checked", {
          total: updated.length
        });
      }
    } catch (error) {
      console.error("Erro ao checar resultados:", error.message || error);
    }
  }

  async refreshStats() {
    try {
      this.historyStats = await signalRepository.getStats();
    } catch (_) {
      this.historyStats = {};
    }
  }

  emitBlocked(signal) {
    const payload = {
      ...signal,
      signal: "WAIT",
      direction: "WAIT",
      confidence: 0,
      explanation: `Bloqueado pela IA: ${
        signal.blockReason || signal.block_reason || "Sem qualidade operacional"
      }`
    };

    emitToAll("execution", {
      executed: false,
      allowed: false,
      reason: payload.blockReason || payload.block_reason || payload.explanation,
      adjustedScore: payload.adjustedScore || payload.finalScore || 0,
      aiAdjustments: payload.aiAdjustments || null,
      aiBlock: payload.aiBlock || null
    }, { cacheLatest: true });
  }

  classifyOpportunity(signal = {}) {
    if (signal.blocked) return "BLOCKED";

    const direction = String(signal.signal || signal.direction || "WAIT").toUpperCase();
    const score = Number(signal.adjustedScore || signal.finalScore || signal.confidence || 0);
    const mode = signal.mode === "aggressive" ? "aggressive" : signal.mode === "conservative" ? "conservative" : "balanced";

    if (!["CALL", "PUT"].includes(direction)) return "WATCHLIST";
    if (signal.marketRegime === "FALLBACK_SIGNAL" || signal.market_regime === "FALLBACK_SIGNAL") {
      return "FALLBACK_SIGNAL";
    }

    const high = mode === "conservative" ? 88 : mode === "aggressive" ? 78 : 82;
    const medium = mode === "conservative" ? 80 : mode === "aggressive" ? 62 : 68;

    if (score >= high) return "HIGH_CONFIDENCE";
    if (score >= medium) return "MEDIUM_CONFIDENCE";

    return "WATCHLIST";
  }

  emitRuntimeUpdate(cycleResults = []) {
    const confirmedHistory = filterConfirmedOperationalSignals(this.latestResults);
    const confirmedThisCycle = filterConfirmedOperationalSignals(cycleResults);
    const blockedAnalyses = cycleResults.filter((item) => !isConfirmedOperationalSignal(item));

    const classifiedResults = cycleResults.map((item) => ({
      ...item,
      opportunityClass: item.opportunityClass || item.status || this.classifyOpportunity(item),
      status: item.status || item.opportunityClass || this.classifyOpportunity(item)
    }));
    const highConfidence = classifiedResults.filter((item) => item.opportunityClass === "HIGH_CONFIDENCE").length;
    const mediumConfidence = classifiedResults.filter((item) => item.opportunityClass === "MEDIUM_CONFIDENCE").length;
    const watchlist = classifiedResults.filter((item) => item.opportunityClass === "WATCHLIST").length;
    const approvalRate = cycleResults.length
      ? Number((((highConfidence + mediumConfidence) / cycleResults.length) * 100).toFixed(2))
      : 0;
    const blockedRate = cycleResults.length
      ? Number(((blockedAnalyses.length / cycleResults.length) * 100).toFixed(2))
      : 0;
    const shadowApprovedBlocks = blockedAnalyses.filter((item) => {
      const mode = item.mode === "aggressive" ? "aggressive" : item.mode === "conservative" ? "conservative" : "balanced";
      const minimum = mode === "conservative" ? 86 : mode === "aggressive" ? 60 : 68;
      return Number(item.finalScore || item.adjustedScore || item.confidence || 0) >= minimum;
    }).length;
    const filterEfficiency = blockedAnalyses.length
      ? Number((((blockedAnalyses.length - shadowApprovedBlocks) / blockedAnalyses.length) * 100).toFixed(2))
      : 0;

    emitToAll("engine:update", {
      ok: true,
      data: {
        connection: {
          engineRunning: this.running,
          isProcessing: this.isProcessing,
          lastCycleAt: this.lastCycleAt,
          rateLimit: this.rateLimit
        },
        signalCenter: {
          bestOpportunity: this.bestOpportunity
        },
        ranking: confirmedHistory,
        history: confirmedHistory,
        blockedAnalyses,
        filters: {
          analyzedSignals: cycleResults.length,
          blockedSignals: blockedAnalyses.length,
          confirmedSignals: confirmedThisCycle.length,
          approvalRate,
          blockedRate,
          watchlistRate: cycleResults.length ? Number(((watchlist / cycleResults.length) * 100).toFixed(2)) : 0,
          highConfidenceRate: cycleResults.length ? Number(((highConfidence / cycleResults.length) * 100).toFixed(2)) : 0,
          mediumConfidenceRate: cycleResults.length ? Number(((mediumConfidence / cycleResults.length) * 100).toFixed(2)) : 0,
          filterEfficiency,
          shadowMode: {
            wouldApproveBlockedSignals: shadowApprovedBlocks,
            blockedSignals: blockedAnalyses.length
          }
        },
        analytics: {
          historyStats: this.historyStats
        },
        runtime: {
          trackedSymbols: this.symbols,
          intervalMs: this.intervalMs,
          rateLimit: this.rateLimit,
          processedThisCycle: cycleResults.length
        }
      },
      timestamp: new Date().toISOString()
    }, { cacheLatest: true, volatile: true });
  }

  async auditDecision(eventType, payload) {
    try {
      await registerAudit(
        eventType,
        `Engine AERIX: ${eventType}`,
        payload,
        payload?.user_id || null
      );
    } catch (_) {}
  }
}

module.exports = new EngineRunnerService();
