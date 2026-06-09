const marketData = require("./market-data.service");
const { runStrategies } = require("../strategy/strategy-runner.service");

const adaptiveService = require("./adaptive.service");
const autoTuningService = require("./auto-tuning.service");
const executionService = require("./execution.service");
const resultCheckerService = require("./result-checker.service");
const predictiveAiService = require("./predictive-ai.service");
const filterAnalyticsService = require("./filter-analytics.service");

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

class EngineRunnerService {
  constructor() {
    this.running = false;
    this.isProcessing = false;
    this.interval = null;
    this.intervalMs = Number(process.env.ENGINE_INTERVAL_MS || 15000);

    this.symbols = String(process.env.SYMBOLS || process.env.DEFAULT_SYMBOLS || "EUR/USD,GBP/USD,USD/JPY,AUD/USD")
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);

    this.symbolCursor = 0;
    this.maxSymbolsPerCycle = Number(process.env.MAX_SYMBOLS_PER_CYCLE || 2);

    this.bestOpportunity = null;
    this.latestResults = [];
    this.historyStats = {};
    this.lastCycleAt = null;
    this.lastStatus = "standby";
    this.signalFrequencyState = this.createSignalFrequencyState();

    this.rateLimiter = new RateLimiterService({
      maxPerMinute: Number(process.env.MAX_REQUESTS_PER_MINUTE || 8)
    }, { cacheLatest: true });

    this.rateLimit = this.rateLimiter.getStats();
  }

  start() {
    if (this.running) return;

    console.log("🚀 Engine institucional iniciada...");
    this.running = true;
    this.lastStatus = "running";

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
      intervalMs: this.intervalMs
    };
  }

  getCurrentMode() {
    const mode = String(process.env.TRADING_MODE || process.env.MODE || "balanced").toLowerCase();

    if (["conservador", "conservative"].includes(mode)) return "conservative";
    if (["agressivo", "aggressive"].includes(mode)) return "aggressive";

    return "balanced";
  }

  createSignalFrequencyState() {
    return {
      conservative: { signalTimestamps: [], analyzedTimestamps: [], firstAnalysisAt: 0, lastSignalAt: 0, lastAdjustment: null },
      balanced: { signalTimestamps: [], analyzedTimestamps: [], firstAnalysisAt: 0, lastSignalAt: 0, lastAdjustment: null },
      aggressive: { signalTimestamps: [], analyzedTimestamps: [], firstAnalysisAt: 0, lastSignalAt: 0, lastAdjustment: null }
    };
  }

  getHealthyFrequencyConfig(mode = "balanced") {
    return autoTuningService.getHealthyFrequencyModeConfig(mode);
  }

  pruneFrequencyWindow(items = [], now = Date.now(), windowMs = 20 * 60 * 1000) {
    return items.filter((timestamp) => now - timestamp <= windowMs);
  }

  registerFrequencyAnalysis(mode = "balanced") {
    const normalizedMode = mode === "conservative" || mode === "aggressive" ? mode : "balanced";
    const state = this.signalFrequencyState[normalizedMode];
    const config = this.getHealthyFrequencyConfig(normalizedMode);
    const now = Date.now();

    state.analyzedTimestamps = this.pruneFrequencyWindow(state.analyzedTimestamps, now, config.droughtWindowMs);
    state.analyzedTimestamps.push(now);

    if (!state.firstAnalysisAt) {
      state.firstAnalysisAt = now;
    }
  }

  registerFrequencySignal(mode = "balanced") {
    const normalizedMode = mode === "conservative" || mode === "aggressive" ? mode : "balanced";
    const state = this.signalFrequencyState[normalizedMode];
    const config = this.getHealthyFrequencyConfig(normalizedMode);
    const now = Date.now();

    state.signalTimestamps = this.pruneFrequencyWindow(state.signalTimestamps, now, config.burstWindowMs);
    state.signalTimestamps.push(now);
    state.lastSignalAt = now;
  }

  getFrequencyControl(mode = "balanced") {
    const normalizedMode = mode === "conservative" || mode === "aggressive" ? mode : "balanced";
    const state = this.signalFrequencyState[normalizedMode];
    const config = this.getHealthyFrequencyConfig(normalizedMode);
    const now = Date.now();

    state.signalTimestamps = this.pruneFrequencyWindow(state.signalTimestamps, now, config.burstWindowMs);
    state.analyzedTimestamps = this.pruneFrequencyWindow(state.analyzedTimestamps, now, config.droughtWindowMs);

    const extraSignals = Math.max(0, state.signalTimestamps.length - config.maxSignals);
    const thresholdAdjustment = Math.min(
      config.maxThresholdAdjustment,
      extraSignals * config.thresholdStep
    );
    const lastSignalAt = state.lastSignalAt || 0;
    const firstAnalysisAt = state.firstAnalysisAt || now;
    const noSignalsYetWithMatureWindow =
      !lastSignalAt &&
      now - firstAnalysisAt >= config.droughtWindowMs &&
      state.analyzedTimestamps.length >= config.minAnalysesForScarcity;
    const isDrought = lastSignalAt
      ? now - lastSignalAt >= config.droughtWindowMs
      : noSignalsYetWithMatureWindow;
    const scarcityRelief = isDrought && state.analyzedTimestamps.length >= config.minAnalysesForScarcity
      ? config.penaltyRelief
      : 0;
    const reasons = [];

    if (thresholdAdjustment > 0) {
      reasons.push(
        `Controle saudável ${config.label}: ${state.signalTimestamps.length}/${config.maxSignals} sinais na janela; threshold temporariamente +${thresholdAdjustment}.`
      );
    }

    if (scarcityRelief > 0) {
      reasons.push(
        `Controle saudável ${config.label}: escassez prolongada; penalidades moderadas aliviadas em até ${scarcityRelief} pontos.`
      );
    }

    state.lastAdjustment = {
      mode: normalizedMode,
      signalCount: state.signalTimestamps.length,
      analyzedCount: state.analyzedTimestamps.length,
      firstAnalysisAt: state.firstAnalysisAt ? new Date(state.firstAnalysisAt).toISOString() : null,
      thresholdAdjustment,
      scarcityRelief,
      reasons,
      updatedAt: new Date(now).toISOString()
    };

    return state.lastAdjustment;
  }

  hasCriticalFrequencyRisk(signal = {}) {
    const severeTerms = [
      "baixa liquidez severa",
      "volatilidade extremamente baixa",
      "inconsistência grave",
      "inconsistencia grave",
      "fallback",
      "histórico insuficiente",
      "historico insuficiente",
      "risco extremo",
      "padrão crítico",
      "padrao critico",
      "padrão severo",
      "padrao severo",
      "baixa performance histórica",
      "baixa performance historica"
    ];
    const text = [
      signal.blockReason,
      signal.block_reason,
      signal.explanation,
      ...(signal.blocks || []),
      ...(signal.reasons || []),
      ...(signal.adaptiveReasons || []),
      ...(signal.tuningReasons || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return severeTerms.some((term) => text.includes(term));
  }

  hasModerateFrequencyPenalty(signal = {}) {
    const moderateTerms = [
      "penalidade",
      "penalizou",
      "redução preventiva",
      "reducao preventiva",
      "risco maior",
      "fraco convertido",
      "moderado entre timeframes",
      "baixa volatilidade convertida",
      "alta volatilidade aplicada"
    ];
    const text = [
      ...(signal.reasons || []),
      ...(signal.adaptiveReasons || []),
      ...(signal.tuningReasons || []),
      ...(signal.operationalTuning?.penaltyReasons || []),
      ...(signal.predictiveAi?.moderateRisks || signal.predictive_ai?.moderateRisks || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return moderateTerms.some((term) => text.includes(term));
  }

  getNextSymbols() {
    const selected = [];

    if (!this.symbols.length) {
      return selected;
    }

    for (let i = 0; i < this.maxSymbolsPerCycle; i += 1) {
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
      const penalty = signal.mode === "aggressive" ? 6 : signal.mode === "balanced" ? 8 : 10;
      const adjustedScore = Math.max(0, score - penalty);
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

      if (adjustedScore < Math.max(58, sniperThreshold - 24)) {
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

  appendFilterBlock(signal, filterName, reason, extra = {}) {
    const blockReason = reason || signal.blockReason || signal.block_reason || "Bloqueio institucional sem motivo detalhado.";
    const event = {
      filterName,
      reason: blockReason,
      symbol: signal.symbol || signal.asset,
      score: Number(extra.score ?? signal.score ?? signal.confidence ?? 0),
      finalScore: Number(extra.finalScore ?? signal.finalScore ?? signal.final_score ?? signal.adjustedScore ?? 0),
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

  applyPredictiveDecisionToSignal(signal, predictiveDecision) {
    const scoreAdjustment = Number(predictiveDecision.scoreAdjustment || 0);
    const finalScore = Math.max(0, Math.min(100, Number(signal.finalScore || 0) + scoreAdjustment));

    return {
      ...signal,
      finalScore,
      final_score: finalScore,
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
          if (!this.rateLimiter.canProceed(3)) {
            this.rateLimit = this.rateLimiter.getStats();
            console.log(
              `⏸ Rate limit protegido: aguardando janela. Uso ${this.rateLimit.usedInCurrentWindow}/${this.rateLimit.maxPerMinute}`
            );
            continue;
          }

          this.rateLimiter.register(3);
          this.rateLimit = this.rateLimiter.getStats();

          const snapshot = await marketData.getMarketSnapshot(symbol);
          const indicators = this.buildIndicators(snapshot, mode);
          this.registerFrequencyAnalysis(mode);

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

          signal = this.applyPredictiveDecisionToSignal(signal, predictiveDecision);
          signal = await this.applyAdaptiveLayers(signal);
          signal = applyLossPenalty(signal, this.latestResults);
          signal = this.applySniperTiming(signal);
          signal = this.applyExecutionValidation(signal);
          signal = this.normalizeForDatabase(signal);

          cycleResults.push(signal);

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

          const saved = await signalRepository.insertSignal(signal);
          signal.id = saved?.id || signal.id;

          this.bestOpportunity = signal;
          this.latestResults = [signal, ...this.latestResults].slice(0, 30);
          this.registerFrequencySignal(mode);

          emitToAll("signal", signal, { cacheLatest: true });
          emitToAll("bestOpportunity", signal, { cacheLatest: true });

          await this.auditDecision("signal_generated", signal);
        } catch (symbolError) {
          console.error(`Erro ao processar ${symbol}:`, symbolError.message || symbolError);

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
      blocks: Array.isArray(strategyResult.blocks) ? strategyResult.blocks : [],
      strategies: strategyResult.strategies || [],
      operationalTuning: strategyResult.operationalTuning || null,
      operational_tuning: strategyResult.operationalTuning || null,
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
      market_regime: this.detectMarketRegime(snapshot),
      entry_price: lastM5?.close ?? null,
      price: lastM5?.close ?? null,
      expires_at: expiresAt.toISOString(),
      expiry: expiresAt.toISOString(),
      expiration: expiresAt.toISOString(),
      created_at: now.toISOString(),
      result: "pending",
      blocked: Boolean(snapshot?.isFallback),
      blockReason: snapshot?.isFallback
        ? "Fonte de dados em fallback; entrada operacional bloqueada."
        : null,
      block_reason: snapshot?.isFallback
        ? "Fonte de dados em fallback; entrada operacional bloqueada."
        : null
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
    const adaptive = await adaptiveService.applyAdaptiveScore(
      signal.finalScore || signal.confidence,
      signal
    );

    signal.finalScore = Number(adaptive.finalScore || signal.finalScore || 0);
    signal.final_score = signal.finalScore;
    signal.adaptiveAdjustment = Number(adaptive.adaptiveAdjustment || 0);
    signal.adaptive_adjustment = signal.adaptiveAdjustment;
    signal.adaptiveReasons = adaptive.adaptiveReasons || [];
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

    const frequencyControl = this.getFrequencyControl(signal.mode);
    const hasCriticalFrequencyRisk = this.hasCriticalFrequencyRisk(signal);
    const hasModerateFrequencyPenalty = this.hasModerateFrequencyPenalty(signal);
    const canApplyScarcityRelief =
      !signal.blocked &&
      !hasCriticalFrequencyRisk &&
      hasModerateFrequencyPenalty &&
      Number(frequencyControl.scarcityRelief || 0) > 0;

    if (canApplyScarcityRelief) {
      const relief = Number(frequencyControl.scarcityRelief || 0);
      const relievedScore = Math.min(100, Number((signal.finalScore + relief).toFixed(2)));

      signal.finalScore = relievedScore;
      signal.final_score = relievedScore;
      signal.frequencyPenaltyRelief = relief;
      signal.frequency_penalty_relief = relief;
    }

    signal.frequencyControl = {
      mode: frequencyControl.mode,
      signalCount: frequencyControl.signalCount,
      analyzedCount: frequencyControl.analyzedCount,
      thresholdAdjustment: frequencyControl.thresholdAdjustment,
      scarcityRelief: canApplyScarcityRelief ? frequencyControl.scarcityRelief : 0,
      criticalRiskProtected: hasCriticalFrequencyRisk,
      moderatePenaltyDetected: hasModerateFrequencyPenalty,
      updatedAt: frequencyControl.updatedAt
    };

    const thresholdFrequencyReasons = (frequencyControl.reasons || []).filter((reason) =>
      reason.includes("threshold temporariamente")
    );

    if (thresholdFrequencyReasons.length) {
      signal.tuningReasons = [...(signal.tuningReasons || []), ...thresholdFrequencyReasons];
      signal.adaptiveReasons = [...(signal.adaptiveReasons || []), ...thresholdFrequencyReasons];
    }

    if (frequencyControl.scarcityRelief > 0 && hasCriticalFrequencyRisk) {
      const protectedReason = "Controle saudável: escassez detectada, mas risco crítico preservou todos os bloqueios institucionais.";
      signal.tuningReasons = [...(signal.tuningReasons || []), protectedReason];
      signal.adaptiveReasons = [...(signal.adaptiveReasons || []), protectedReason];
    }

    if (canApplyScarcityRelief) {
      const reliefReason = `Controle saudável: alívio aplicado somente sobre penalidades moderadas (+${signal.frequencyPenaltyRelief}).`;
      signal.tuningReasons = [...(signal.tuningReasons || []), reliefReason];
      signal.adaptiveReasons = [...(signal.adaptiveReasons || []), reliefReason];
    }

    signal.timing = this.buildTiming(signal);

    const minimumScore = Number(
      signal.dynamicThresholds?.minimumScore ??
      (signal.mode === "conservative"
        ? 78
        : signal.mode === "aggressive"
          ? 61
          : 68)
    );

    const frequencyThresholdAdjustment = Number(frequencyControl.thresholdAdjustment || 0);
    const adjustedMinimumScore = Math.min(96, minimumScore + frequencyThresholdAdjustment);
    const tolerance = signal.mode === "aggressive" ? 8 : signal.mode === "balanced" ? 4 : 0;
    const scoreGap = adjustedMinimumScore - signal.finalScore;

    signal.healthyFrequencyMinimumScore = adjustedMinimumScore;
    signal.healthy_frequency_minimum_score = adjustedMinimumScore;

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
        `Score abaixo do mínimo institucional após auto tuning (${signal.finalScore.toFixed(1)} < ${adjustedMinimumScore})`,
        {
          score: signal.confidence,
          finalScore: signal.finalScore
        }
      );
    } else if (scoreGap > 0) {
      signal.reasons = [
        ...(signal.reasons || []),
        `Score abaixo do mínimo aprendido tratado como penalidade em ${signal.mode} (${signal.finalScore.toFixed(1)} < ${adjustedMinimumScore}).`
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
    signal.aiAdjustments = validation.aiAdjustments || signal.aiAdjustments || null;
    signal.aiBlock = validation.aiBlock || signal.aiBlock || null;

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
      user_id: signal.user_id || 1,

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

      explanation: signal.explanation || "",
      timing: signal.timing || "AGUARDANDO",
      entry_in_seconds: Number(signal.entry_in_seconds || signal.entryInSeconds || 0),
      entryInSeconds: Number(signal.entryInSeconds || signal.entry_in_seconds || 0),
      timing_mode: signal.timing_mode || signal.timingMode || null,
      timing_confidence: signal.timing_confidence ?? signal.timingConfidence ?? null,

      dynamicThresholds: signal.dynamicThresholds || null,
      thresholdHistory: signal.thresholdHistory || null,
      thresholdChanges: signal.thresholdChanges || [],
      thresholdPerformance: signal.thresholdPerformance || null,
      frequencyControl: signal.frequencyControl || null,
      frequencyPenaltyRelief: Number(signal.frequencyPenaltyRelief || signal.frequency_penalty_relief || 0),
      frequency_penalty_relief: Number(signal.frequencyPenaltyRelief || signal.frequency_penalty_relief || 0),
      healthyFrequencyMinimumScore: Number(signal.healthyFrequencyMinimumScore || signal.healthy_frequency_minimum_score || 0),
      healthy_frequency_minimum_score: Number(signal.healthyFrequencyMinimumScore || signal.healthy_frequency_minimum_score || 0),

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

  async recordFilterAnalytics(signal, source = "engine") {
    try {
      await filterAnalyticsService.recordBlockedSignal(signal, source);
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

  emitRuntimeUpdate(cycleResults = []) {
    const confirmedHistory = filterConfirmedOperationalSignals(this.latestResults);
    const confirmedThisCycle = filterConfirmedOperationalSignals(cycleResults);
    const blockedAnalyses = cycleResults.filter((item) => !isConfirmedOperationalSignal(item));

    const approvalRate = cycleResults.length
      ? Number(((confirmedThisCycle.length / cycleResults.length) * 100).toFixed(2))
      : 0;
    const blockedRate = cycleResults.length
      ? Number(((blockedAnalyses.length / cycleResults.length) * 100).toFixed(2))
      : 0;
    const shadowApprovedBlocks = blockedAnalyses.filter((item) => {
      const mode = item.mode === "aggressive" ? "aggressive" : item.mode === "conservative" ? "conservative" : "balanced";
      const minimum = mode === "conservative" ? 88 : mode === "aggressive" ? 64 : 72;
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
