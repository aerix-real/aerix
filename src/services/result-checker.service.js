const signalRepository = require("../repositories/signal.repository");
const { getMarketSnapshot } = require("./market-data.service");
const executionService = require("./execution.service");

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

      return updated;
    } finally {
      this.isChecking = false;
    }
  }
}

module.exports = new ResultCheckerService();