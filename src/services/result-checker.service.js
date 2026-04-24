const signalRepository = require("../repositories/signal.repository");
const { getMarketSnapshot } = require("./market-data.service");

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

    const direction = String(signal.signal || "").toUpperCase();

    if (direction === "CALL") {
      return resultPrice > entryPrice ? "win" : "loss";
    }

    if (direction === "PUT") {
      return resultPrice < entryPrice ? "win" : "loss";
    }

    return "loss";
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
          const lastCandle =
            snapshot?.timeframes?.m5?.candles?.[
              snapshot.timeframes.m5.candles.length - 1
            ] || null;

          const resultPrice = this.normalizePrice(lastCandle?.close);
          const result = this.resolveSignalResult(signal, resultPrice);

          const saved = await signalRepository.finalizeSignalResult(signal.id, {
            result,
            resultPrice
          });

          updated.push(saved);
        } catch (_) {
          // segue o loop sem derrubar o checker
        }
      }

      return updated;
    } finally {
      this.isChecking = false;
    }
  }
}

module.exports = new ResultCheckerService();