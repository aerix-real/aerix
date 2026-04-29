const marketData = require("./market-data.service");
const { runStrategies } = require("../strategy/strategy-runner.service");

const adaptiveService = require("./adaptive.service");
const autoTuningService = require("./auto-tuning.service");
const executionService = require("./execution.service");
const resultCheckerService = require("./result-checker.service");
const predictiveAiService = require("./predictive-ai.service");

const { analyzeIndicators } = require("./indicator-engine.service");
const { explainSignal, applyLossPenalty } = require("./signal-ai.service");
const { registerAudit } = require("./audit.service");
const RateLimiterService = require("./rate-limiter.service");

const signalRepository = require("../repositories/signal.repository");
const { emitToAll } = require("../websocket/socket");

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

    this.rateLimiter = new RateLimiterService({
      maxPerMinute: Number(process.env.MAX_REQUESTS_PER_MINUTE || 8)
    });

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

    if (!["CALL", "PUT"].includes(direction)) {
      return signal;
    }

    if (score >= 90) {
      return {
        ...signal,
        timing: "ENTRAR AGORA",
        timing_mode: "SNIPER_FORTE",
        timing_confidence: 100
      };
    }

    if (!this.isSniperMoment()) {
      return {
        ...signal,
        blocked: true,
        signal: "WAIT",
        direction: "WAIT",
        timing: "AGUARDANDO VIRADA DA VELA",
        timing_mode: "SNIPER_WAIT",
        timing_confidence: 60,
        blockReason: signal.blockReason || "Fora da janela sniper de entrada",
        block_reason: signal.blockReason || "Fora da janela sniper de entrada",
        blocks: [
          ...(signal.blocks || []),
          "Fora da janela sniper de entrada"
        ]
      };
    }

    return {
      ...signal,
      timing: "ENTRAR AGORA",
      timing_mode: "SNIPER_OK",
      timing_confidence: 95
    };
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
      blocks: predictiveDecision.risks || [],
      predictiveAi: predictiveDecision,
      predictive_ai: predictiveDecision,
      preSignalScore: predictiveDecision.preScore || 0,
      pre_signal_score: predictiveDecision.preScore || 0,
      result: "pending"
    });
  }

  applyPredictiveDecisionToSignal(signal, predictiveDecision) {
    return {
      ...signal,
      predictiveAi: predictiveDecision,
      predictive_ai: predictiveDecision,
      preSignalScore: predictiveDecision.preScore || 0,
      pre_signal_score: predictiveDecision.preScore || 0,
      reasons: [
        ...(signal.reasons || []),
        ...(predictiveDecision.reasons || [])
      ],
      blocks: [
        ...(signal.blocks || []),
        ...(predictiveDecision.risks || [])
      ],
      adaptiveReasons: [
        ...(signal.adaptiveReasons || []),
        `Pre-score IA: ${predictiveDecision.preScore || 0}%`
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
            await this.auditDecision("signal_blocked", signal);
            continue;
          }

          const saved = await signalRepository.insertSignal(signal);
          signal.id = saved?.id || signal.id;

          this.bestOpportunity = signal;
          this.latestResults = [signal, ...this.latestResults].slice(0, 30);

          emitToAll("signal", signal);
          emitToAll("bestOpportunity", signal);

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

    if (score >= 88) return "ENTRAR AGORA";
    if (score >= 78) return "PREPARAR ENTRADA";

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
      mtf: strategyResult.mtf || {},
      market: snapshot?.timeframes || {},
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
      blocked: false,
      blockReason: null,
      block_reason: null
    };

    baseSignal.timing = this.buildTiming(baseSignal);

    baseSignal.explanation = explainSignal({
      symbol,
      signal: baseSignal.signal,
      confidence: baseSignal.confidence,
      reasons: baseSignal.reasons,
      modeConfig: {
        label: mode,
        minimumConfidence: mode === "conservative" ? 78 : mode === "aggressive" ? 66 : 72
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
    signal.learningProfile = adaptive.learningProfile || null;

    const hardBlock = await adaptiveService.shouldHardBlock(signal);

    if (hardBlock?.blocked) {
      signal.blocked = true;
      signal.blockReason = hardBlock.reason || "Bloqueado pela IA adaptativa";
      signal.block_reason = signal.blockReason;
    }

    const tuning = await autoTuningService.applyAutoTuning(signal);

    signal.finalScore = Number(tuning.tunedScore || signal.finalScore || 0);
    signal.final_score = signal.finalScore;
    signal.tuningWeight = Number(tuning.tuningWeight || 1);
    signal.tuning_weight = signal.tuningWeight;
    signal.tuningReasons = tuning.tuningReasons || [];
    signal.tuningProfile = tuning.tuningProfile || null;

    signal.timing = this.buildTiming(signal);

    const minimumScore =
      signal.mode === "conservative"
        ? 78
        : signal.mode === "aggressive"
          ? 66
          : 72;

    if (signal.finalScore < minimumScore) {
      signal.blocked = true;
      signal.blockReason =
        signal.blockReason || "Score abaixo do mínimo institucional após auto tuning";
      signal.block_reason = signal.blockReason;
      signal.signal = "WAIT";
      signal.direction = "WAIT";
    }

    return signal;
  }

  applyExecutionValidation(signal) {
    const validation = executionService.validate(signal);

    signal.execution = validation;
    signal.executionAllowed = validation.allowed;
    signal.adjustedScore = validation.adjustedScore ?? signal.finalScore;
    signal.aiAdjustments = validation.aiAdjustments || signal.aiAdjustments || null;
    signal.aiBlock = validation.aiBlock || signal.aiBlock || null;

    if (!validation.allowed) {
      signal.blocked = true;
      signal.blockReason =
        validation.reason || signal.blockReason || "Bloqueado pela validação operacional";
      signal.block_reason = signal.blockReason;
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

      explanation: signal.explanation || "",
      timing: signal.timing || "AGUARDANDO",
      entry_in_seconds: Number(signal.entry_in_seconds || signal.entryInSeconds || 0),
      entryInSeconds: Number(signal.entryInSeconds || signal.entry_in_seconds || 0),
      timing_mode: signal.timing_mode || signal.timingMode || null,
      timing_confidence: signal.timing_confidence ?? signal.timingConfidence ?? null,

      market_regime: signal.market_regime || signal.marketRegime || "NORMAL",

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

  async checkResults() {
    try {
      const updated = await resultCheckerService.checkPendingSignals();

      if (updated.length) {
        emitToAll("history", updated);

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

    this.latestResults = [payload, ...this.latestResults].slice(0, 30);

    emitToAll("signal", payload);
    emitToAll("execution", {
      executed: false,
      allowed: false,
      reason: payload.blockReason || payload.block_reason || payload.explanation,
      adjustedScore: payload.adjustedScore || payload.finalScore || 0,
      aiAdjustments: payload.aiAdjustments || null,
      aiBlock: payload.aiBlock || null
    });
  }

  emitRuntimeUpdate(cycleResults = []) {
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
        ranking: this.latestResults,
        history: this.latestResults,
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
    });
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