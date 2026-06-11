const signalRepository = require("../repositories/signal.repository");
const { getMarketSnapshot } = require("./market-data.service");
const executionService = require("./execution.service");
const filterAnalyticsService = require("./filter-analytics.service");
const { registerAudit } = require("./audit.service");

class ResultCheckerService {
  constructor() {
    this.isChecking = false;
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
        try {
          const snapshot = await getMarketSnapshot(signal.symbol);
          const candles = snapshot?.timeframes?.m5?.candles || [];
          const lastCandle = candles[candles.length - 1] || null;

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
            await filterAnalyticsService.updateShadowOutcomes(saved, finalResult).catch(() => 0);
            await this.registerOutcomeAudit(signal, saved, finalResult, resultPrice).catch((error) => {
              console.error("Erro ao registrar signal_outcome_audit:", error.message || error);
            });

            updated.push({
              ...saved,
              learned: true,
              learningKey: executionService.getKey(learningSignal)
            });
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