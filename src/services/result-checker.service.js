const signalRepository = require("../repositories/signal.repository");
const { getMarketSnapshot } = require("./market-data.service");
const executionService = require("./execution.service");
const filterAnalyticsService = require("./filter-analytics.service");
const { registerAudit } = require("./audit.service");
const strategyIntelligenceService = require("./strategy-intelligence.service");
const { emitToAll } = require("../websocket/socket");

const RESULT_RETRY_DELAYS_MS = [0, 1000, 3000, 5000, 10000];
const RESULT_SCAN_INTERVAL_MS = Math.max(1000, Number(process.env.RESULT_SCAN_INTERVAL_MS || 1000));
const RESULT_TIMEFRAME_MS = 5 * 60 * 1000;

function realtimeAudit(event, fields = {}) {
  console.log(JSON.stringify({ scope: "aerix_realtime_terminal_audit", event, timestamp: new Date().toISOString(), ...fields }));
}

class ResultCheckerService {
  constructor() {
    this.isChecking = false;
    this.timer = null;
    this.retryState = new Map();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkPendingSignals().catch(() => {}), RESULT_SCAN_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.retryState.clear();
  }

  normalizePrice(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  resolveSignalResult(signal, resultPrice) {
    const entryPrice = this.normalizePrice(signal.entry_price);

    if (entryPrice === null || resultPrice === null) {
      return "loss";
    }

    const configuredTolerance = Number(signal.meta?.price_tolerance ?? signal.meta?.tick_size);
    const tolerance = Number.isFinite(configuredTolerance) && configuredTolerance >= 0
      ? configuredTolerance
      : Math.max(Number.EPSILON * Math.abs(entryPrice) * 8, 1 / (10 ** Math.max(2, Number(signal.meta?.provider_precision || 8))));

    if (Math.abs(resultPrice - entryPrice) <= tolerance) {
      return "draw";
    }

    const direction = String(signal.signal || signal.direction || "").toUpperCase();

    if (["CALL", "BUY", "LONG"].includes(direction)) {
      return resultPrice > entryPrice ? "win" : "loss";
    }

    if (["PUT", "SELL", "SHORT"].includes(direction)) {
      return resultPrice < entryPrice ? "win" : "loss";
    }

    return "loss";
  }

  getConfirmedExpirationCandle(signal, candles = [], now = Date.now()) {
    const expiresAt = new Date(signal.expires_at).getTime();
    if (!Number.isFinite(expiresAt)) return null;
    return candles.find((candle) => {
      const candleAt = new Date(candle.datetime || candle.timestamp || candle.time).getTime();
      const duration = Number(candle.durationMs || candle.intervalMs || RESULT_TIMEFRAME_MS);
      const closesAt = candleAt + duration;
      const explicitlyOpen = candle.closed === false || candle.isClosed === false || candle.complete === false;
      return Number.isFinite(candleAt) && !explicitlyOpen && closesAt <= now && expiresAt > candleAt && expiresAt <= closesAt;
    }) || null;
  }

  shouldAttempt(signal, now = Date.now()) {
    const expiresAt = new Date(signal.expires_at).getTime();
    const state = this.retryState.get(signal.id) || { retryNumber: 0 };
    const delay = RESULT_RETRY_DELAYS_MS[state.retryNumber];
    if (delay === undefined || now < expiresAt + delay) return false;
    this.retryState.set(signal.id, { retryNumber: state.retryNumber + 1 });
    return true;
  }

  buildOutcomeAuditPayload(signal = {}, saved = {}, finalResult = null, resultPrice = null) {
    return {
      symbol: saved.symbol || signal.symbol || "UNKNOWN",
      signal: saved.signal || saved.direction || signal.signal || signal.direction || "WAIT",
      strategyName: saved.strategy_name || signal.strategy_name || signal.strategyName || null,
      score: Number(saved.adjusted_score || saved.final_score || signal.adjusted_score || signal.final_score || signal.finalScore || signal.confidence || 0),
      confidence: Number(saved.confidence || signal.confidence || 0),
      entryPrice: this.normalizePrice(saved.entry_price ?? signal.entry_price),
      resultPrice: this.normalizePrice(saved.result_price ?? resultPrice),
      result: finalResult || saved.result || null,
      createdAt: saved.created_at || signal.created_at || null,
      checkedAt: saved.checked_at || new Date().toISOString(),
      marketRegime: saved.market_regime || signal.market_regime || signal.marketRegime || "NORMAL"
    };
  }

  async registerOutcomeAudit(signal, saved, finalResult, resultPrice) {
    const payload = this.buildOutcomeAuditPayload(signal, saved, finalResult, resultPrice);

    console.log(JSON.stringify({
      scope: "aerix_signal_outcome_audit",
      event: "signal_outcome_audit",
      timestamp: new Date().toISOString(),
      ...payload
    }));

    await registerAudit(
      "signal_outcome_audit",
      "Resultado operacional do sinal AERIX",
      payload,
      saved?.user_id || signal?.user_id || null
    );

    return payload;
  }

  buildLearningSignal(signal, savedResult) {
    return {
      ...signal,
      symbol: signal.symbol,
      signal: signal.signal || signal.direction,
      direction: signal.direction || signal.signal,
      strategyName: signal.strategy_name || signal.strategyName,
      finalScore: Number(signal.final_score || signal.finalScore || signal.confidence || 0),
      confidence: Number(signal.confidence || signal.final_score || 0),
      market_regime: signal.market_regime,
      entryQuality: signal.entry_quality,
      timing: signal.timing,
      result: savedResult
    };
  }

  async checkPendingSignals() {
    if (this.isChecking) return [];

    this.isChecking = true;

    try {
      const pendingSignals = await signalRepository.getExpiredPendingSignals(50);
      const updated = [];

      for (const signal of pendingSignals) {
        if (!this.shouldAttempt(signal)) continue;
        const retryNumber = (this.retryState.get(signal.id)?.retryNumber || 1) - 1;
        try {
          realtimeAudit("result_check_started", { signalId: signal.id, operationId: signal.id, symbol: signal.symbol, retryNumber });
          const snapshot = await getMarketSnapshot(signal.symbol);
          const candles = snapshot?.timeframes?.m5?.candles || [];
          const lastCandle = this.getConfirmedExpirationCandle(signal, candles);

          if (!lastCandle) {
            const exhausted = retryNumber >= RESULT_RETRY_DELAYS_MS.length - 1;
            realtimeAudit(exhausted ? "result_check_failed" : "result_check_retry", {
              signalId: signal.id, operationId: signal.id, symbol: signal.symbol, retryNumber,
              expiresAt: signal.expires_at, candleClosed: false
            });
            continue;
          }

          const resultPrice = this.normalizePrice(lastCandle?.close);
          if (resultPrice === null) continue;
          const finalResult = this.resolveSignalResult(signal, resultPrice);
          realtimeAudit("result_price_received", { signalId: signal.id, symbol: signal.symbol, resultPrice, provider: snapshot?.provider, candleTimestamp: lastCandle.datetime, candleClosed: true });
          realtimeAudit("result_calculated", { signalId: signal.id, symbol: signal.symbol, entryPrice: signal.entry_price, resultPrice, result: finalResult });

          const saved = await signalRepository.finalizeSignalResult(signal.id, {
            result: finalResult,
            resultPrice
          });

          if (saved) {
            this.retryState.delete(signal.id);
            realtimeAudit("result_persisted", { signalId: signal.id, operationId: signal.id, symbol: signal.symbol, result: finalResult, persistenceStatus: "persisted" });
            const learningSignal = this.buildLearningSignal(signal, finalResult);

            // 🧠 IA aprende com WIN/LOSS
            executionService.learnFromResult(learningSignal, finalResult);
            await strategyIntelligenceService.learnFromOutcome(saved, finalResult).catch((error) => {
              console.error("Erro ao atualizar strategy_intelligence:", error.message || error);
            });
            await filterAnalyticsService.updateShadowOutcomes(saved, finalResult).catch(() => 0);
            await this.registerOutcomeAudit(signal, saved, finalResult, resultPrice).catch((error) => {
              console.error("Erro ao registrar signal_outcome_audit:", error.message || error);
            });

            updated.push({
              ...saved,
              learned: true,
              learningKey: executionService.getKey(learningSignal)
            });

            const resultEvent = emitToAll("signal:result", saved, { cacheLatest: true });
            emitToAll("operation:closed", saved);
            emitToAll("history:updated", saved, { cacheLatest: true });
            const analytics = { reason: "signal_result", signalId: saved.id, updatedAt: new Date().toISOString() };
            emitToAll("analytics:updated", analytics, { cacheLatest: true });
            // Backward compatibility for deployed terminals.
            emitToAll("signal-result-updated", saved);
            realtimeAudit("result_broadcast", { eventId: resultEvent.eventId, signalId: saved.id, operationId: saved.id, symbol: saved.symbol, result: finalResult, broadcastStatus: "sent" });
          }
        } catch (error) {
          console.error(
            `Erro ao verificar resultado do sinal ${signal.id}:`,
            error.message || error
          );
        }
      }

      return updated;
    } finally {
      this.isChecking = false;
    }
  }
}

module.exports = new ResultCheckerService();
