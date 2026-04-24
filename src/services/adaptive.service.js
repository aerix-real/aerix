const signalRepository = require("../repositories/signal.repository");

class AdaptiveService {
  async getSymbolScoreBoost(symbol) {
    const perf = await signalRepository.getPerformanceBySymbol(symbol);

    if (!perf || Number(perf.total) < 10) return 0;

    const winrate = Number(perf.wins) / Number(perf.total);

    if (winrate >= 0.65) return 8;
    if (winrate >= 0.55) return 4;
    if (winrate <= 0.35) return -10;
    if (winrate <= 0.45) return -6;

    return 0;
  }

  async getHourScoreBoost(hour) {
    const perf = await signalRepository.getPerformanceByHour();
    const data = perf.find((p) => Number(p.hour) === Number(hour));

    if (!data || Number(data.total) < 5) return 0;

    const winrate = Number(data.wins) / Number(data.total);

    if (winrate >= 0.65) return 6;
    if (winrate <= 0.4) return -6;

    return 0;
  }

  async applyAdaptiveScore(baseScore, symbol) {
    const now = new Date();
    const hour = now.getHours();

    const symbolBoost = await this.getSymbolScoreBoost(symbol);
    const hourBoost = await this.getHourScoreBoost(hour);

    const final = Number(baseScore || 0) + symbolBoost + hourBoost;

    return {
      finalScore: Math.max(0, Math.min(100, Number(final.toFixed(2)))),
      adjustments: {
        symbolBoost,
        hourBoost
      }
    };
  }
}

module.exports = new AdaptiveService();