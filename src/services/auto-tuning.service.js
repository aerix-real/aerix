const signalRepository = require("../repositories/signal.repository");

function clamp(value, min = 0.65, max = 1.35) {
  return Math.max(min, Math.min(max, Number(value || 1)));
}

class AutoTuningService {
  async getTuningProfile() {
    const stats = await signalRepository.getStats();

    return {
      bySymbol: stats.bySymbol || {},
      byHour: stats.byHour || {},
      byStrategy: stats.byStrategy || {},
      lossPatterns: stats.lossPatterns || {}
    };
  }

  calculateStrategyWeight(strategyName, stats = {}) {
    const strategy = stats.byStrategy?.[strategyName];

    if (!strategy || strategy.total < 6) return 1;

    if (strategy.winrate >= 75) return 1.18;
    if (strategy.winrate >= 65) return 1.10;
    if (strategy.winrate <= 35) return 0.78;
    if (strategy.winrate <= 45) return 0.88;

    return 1;
  }

  calculateSymbolWeight(symbol, stats = {}) {
    const symbolStats = stats.bySymbol?.[symbol];

    if (!symbolStats || symbolStats.total < 6) return 1;

    if (symbolStats.winrate >= 75) return 1.15;
    if (symbolStats.winrate >= 65) return 1.08;
    if (symbolStats.winrate <= 35) return 0.80;
    if (symbolStats.winrate <= 45) return 0.90;

    return 1;
  }

  calculateHourWeight(stats = {}) {
    const hour = new Date().getHours();
    const hourStats = stats.byHour?.[hour];

    if (!hourStats || hourStats.total < 6) {
      return {
        hour,
        weight: 1
      };
    }

    let weight = 1;

    if (hourStats.winrate >= 75) weight = 1.14;
    else if (hourStats.winrate >= 65) weight = 1.07;
    else if (hourStats.winrate <= 35) weight = 0.78;
    else if (hourStats.winrate <= 45) weight = 0.88;

    return {
      hour,
      weight
    };
  }

  async applyAutoTuning(signal = {}) {
    const stats = await this.getTuningProfile();

    const symbol = signal.symbol || signal.asset || "unknown";
    const strategyName =
      signal.strategyName ||
      signal.strategy_name ||
      signal.strategy ||
      "unknown";

    const baseScore = Number(
      signal.finalScore ||
      signal.final_score ||
      signal.score ||
      signal.confidence ||
      0
    );

    const strategyWeight = this.calculateStrategyWeight(strategyName, stats);
    const symbolWeight = this.calculateSymbolWeight(symbol, stats);
    const hourData = this.calculateHourWeight(stats);

    const finalWeight = clamp(
      (strategyWeight * 0.45) +
      (symbolWeight * 0.35) +
      (hourData.weight * 0.20)
    );

    const tunedScore = Math.max(
      0,
      Math.min(100, Number((baseScore * finalWeight).toFixed(2)))
    );

    const reasons = [];

    if (strategyWeight > 1) reasons.push("Estratégia com performance positiva recebeu boost.");
    if (strategyWeight < 1) reasons.push("Estratégia com performance fraca foi reduzida.");

    if (symbolWeight > 1) reasons.push("Ativo com bom histórico recebeu boost.");
    if (symbolWeight < 1) reasons.push("Ativo com histórico fraco foi penalizado.");

    if (hourData.weight > 1) reasons.push("Horário atual favorece operações.");
    if (hourData.weight < 1) reasons.push("Horário atual apresenta risco maior.");

    return {
      tunedScore,
      tuningWeight: finalWeight,
      tuningReasons: reasons,
      tuningProfile: {
        strategyWeight,
        symbolWeight,
        hourWeight: hourData.weight,
        hour: hourData.hour
      }
    };
  }
}

module.exports = new AutoTuningService();