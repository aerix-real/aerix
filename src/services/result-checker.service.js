const signalRepository = require("../repositories/signal.repository");
const { getMarketSnapshot } = require("./market-data.service");
const executionService = require("./execution.service");
const filterAnalyticsService = require("./filter-analytics.service");
const { registerAudit } = require("./audit.service");
const strategyIntelligenceService = require("./strategy-intelligence.service");
const { toUtcIso, emitTimezoneAudit } = require("../utils/timezone");
const { emitRealtime } = require("../websocket/socket");

const RESULT_RETRY_DELAYS_MS = Object.freeze([0, 1000, 3000, 5000, 10000]);

class ResultCheckerService {
  constructor() {
    this.isChecking = false;
  }

  wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  async getClosedCandle(signal) {
    for (const delayMs of RESULT_RETRY_DELAYS_MS) {
      if (delayMs) await this.wait(delayMs);
      const snapshot = await getMarketSnapshot(signal.symbol);
      const candles = snapshot?.timeframes?.m5?.candles || [];
      const expirationMs = new Date(signal.expires_at).getTime();
      const closed = [...candles].reverse().find((candle) => {
        const closeTime = new Date(candle.closeTime || candle.close_time || candle.datetime || candle.timestamp).getTime();
        return Number.isFinite(closeTime) && closeTime >= expirationMs && closeTime <= Date.now();
      });
      if (closed && this.normalizePrice(closed.close) !== null) return closed;
    }
    return null;
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

    if (resultPrice === entryPrice) {
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
      checkedAt: toUtcIso(saved.checked_at || new Date()),
      marketRegime: saved.market_regime || signal.market_regime || signal.marketRegime || "NORMAL"
    };
  }

  async registerOutcomeAudit(signal, saved, finalResult, resultPrice) {
    const payload = this.buildOutcomeAuditPayload(signal, saved, finalResult, resultPrice);
    emitTimezoneAudit("result_time_resolved", { normalizedUtc: payload.checkedAt, signalId: saved?.id || signal?.id, symbol: payload.symbol, source: "result_checker" });

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
        try {
          const lastCandle = await this.getClosedCandle(signal);
          if (!lastCandle) continue;

          const resultPrice = this.normalizePrice(lastCandle?.close);
          const finalResult = this.resolveSignalResult(signal, resultPrice);

          const saved = await signalRepository.finalizeSignalResult(signal.id, {
            result: finalResult,
            resultPrice
          });

          if (saved) {
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

            emitRealtime("signal:result", saved, { cacheLatest: true });
            emitRealtime("history:updated", saved, { cacheLatest: true });
            emitRealtime("analytics:updated", { refresh: true, signalId: saved.id });
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
