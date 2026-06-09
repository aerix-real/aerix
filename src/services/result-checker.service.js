const signalRepository = require("../repositories/signal.repository");
const { getMarketSnapshot } = require("./market-data.service");
const executionService = require("./execution.service");
const shadowModeService = require("./shadow-mode.service");

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

    if (!entryPrice || !resultPrice) {
      return "loss";
    }

    const direction = String(signal.signal || signal.direction || "").toUpperCase();

    if (direction === "CALL") {
      return resultPrice > entryPrice ? "win" : "loss";
    }

    if (direction === "PUT") {
      return resultPrice < entryPrice ? "win" : "loss";
    }

    return "loss";
  }

  buildShadowSignal(signal) {
    const originalSignal = signal.original_signal || {};

    return {
      ...originalSignal,
      id: signal.id,
      symbol: signal.symbol,
      signal: signal.original_direction || originalSignal.signal || originalSignal.direction,
      direction: signal.original_direction || originalSignal.direction || originalSignal.signal,
      entry_price: signal.entry_price,
      final_score: signal.original_score,
      finalScore: Number(signal.original_score || 0),
      confidence: Number(signal.original_confidence || signal.original_score || 0)
    };
  }

  async checkPendingShadowSignals(limit = 50) {
    const pendingSignals = await shadowModeService.getExpiredPending(limit);
    const updated = [];

    for (const signal of pendingSignals) {
      try {
        const snapshot = await getMarketSnapshot(signal.symbol);
        const candles = snapshot?.timeframes?.m5?.candles || [];
        const lastCandle = candles[candles.length - 1] || null;

        const resultPrice = this.normalizePrice(lastCandle?.close);
        const shadowSignal = this.buildShadowSignal(signal);
        const finalResult = this.resolveSignalResult(shadowSignal, resultPrice);

        const saved = await shadowModeService.finalizeShadowResult(signal.id, {
          result: finalResult,
          resultPrice
        });

        if (saved) updated.push(saved);
      } catch (error) {
        console.error(
          `Erro ao verificar shadow mode ${signal.id}:`,
          error.message || error
        );
      }
    }

    return updated;
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

      const shadowUpdated = await this.checkPendingShadowSignals(50);

      return updated.map((item) => ({ ...item, shadowModeUpdated: shadowUpdated.length }));
    } finally {
      this.isChecking = false;
    }
  }
}

module.exports = new ResultCheckerService();