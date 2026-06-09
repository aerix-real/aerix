const signalRepository = require("../repositories/signal.repository");
const dynamicThresholdService = require("../modules/dynamic-threshold");

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
      byMarketRegime: stats.byMarketRegime || {},
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

  calculateMarketRegimeWeight(marketRegime, stats = {}) {
    const regimeStats = stats.byMarketRegime?.[marketRegime];

    if (!regimeStats || regimeStats.total < 6) return 1;

    if (regimeStats.winrate >= 75) return 1.12;
    if (regimeStats.winrate >= 65) return 1.06;
    if (regimeStats.winrate <= 35) return 0.80;
    if (regimeStats.winrate <= 45) return 0.90;

    return 1;
  }

  async applyAutoTuning(signal = {}) {
    const stats = await this.getTuningProfile();

    const symbol = signal.symbol || signal.asset || "unknown";
    const strategyName =
      signal.strategyName ||
      signal.strategy_name ||
      signal.strategy ||
      "unknown";

    const marketRegime = signal.marketRegime || signal.market_regime || "NORMAL";
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
    const marketRegimeWeight = this.calculateMarketRegimeWeight(marketRegime, stats);
    const dynamicThresholds = signal.dynamicThresholds || await dynamicThresholdService.learn({
      ...signal,
      symbol,
      strategyName,
      marketRegime,
      hour: hourData.hour
    });

    const finalWeight = clamp(
      (strategyWeight * 0.36) +
      (symbolWeight * 0.29) +
      (hourData.weight * 0.18) +
      (marketRegimeWeight * 0.17)
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
    if (marketRegimeWeight > 1) reasons.push("Regime de mercado favorece operações.");
    if (marketRegimeWeight < 1) reasons.push("Regime de mercado exige redução preventiva.");

    return {
      tunedScore,
      tuningWeight: finalWeight,
      tuningReasons: [...reasons, ...(dynamicThresholds.reasons || [])],
      dynamicThresholds,
      tuningProfile: {
        strategyWeight,
        symbolWeight,
        hourWeight: hourData.weight,
        marketRegimeWeight,
        marketRegime,
        hour: hourData.hour,
        dynamicThresholds: {
          minimumScore: dynamicThresholds.minimumScore,
          confidence: dynamicThresholds.confidence,
          sniperTiming: dynamicThresholds.sniperTiming,
          adaptiveAdjustment: dynamicThresholds.adaptiveAdjustment
        }
      }
    };
  }
}

module.exports = new AutoTuningService();