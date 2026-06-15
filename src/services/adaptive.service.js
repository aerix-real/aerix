const signalRepository = require("../repositories/signal.repository");
const dynamicThresholdService = require("../modules/dynamic-threshold");

function clamp(value, min = -30, max = 30) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function getAdaptiveRampUpLimit(totalSignals = 0) {
  const total = Number(totalSignals || 0);

  if (total <= 100) return 5;
  if (total <= 300) return 10;
  if (total <= 1000) return 15;

  return 20;
}

function winRate(wins, total) {
  if (!total) return 0;
  return Number(((Number(wins || 0) / Number(total || 0)) * 100).toFixed(2));
}

class AdaptiveService {
  async getLearningProfile(symbol, signal = "WAIT", strategyName = "unknown", context = {}) {
    const stats = await signalRepository.getStats();
    const hour = context.hour ?? new Date().getHours();
    const marketRegime = context.marketRegime || context.market_regime || "NORMAL";

    const symbolStats = stats.bySymbol?.[symbol];
    const hourStats = stats.byHour?.[hour];
    const strategyStats = stats.byStrategy?.[strategyName];
    const marketRegimeStats = stats.byMarketRegime?.[marketRegime];
    const symbolSignalStats = stats.bySymbolSignal?.[`${symbol}:${signal}`];
    const lossPattern = stats.lossPatterns?.[`${symbol}:${signal}:${strategyName}:${hour}`];

    return {
      hour,
      marketRegime,
      symbolStats,
      hourStats,
      strategyStats,
      marketRegimeStats,
      symbolSignalStats,
      lossPattern,
      totalHistoricalSignals: Number(stats.totalHistoricalSignals || stats.global?.totalHistoricalSignals || stats.global?.total || 0)
    };
  }

  calculateAdjustment(profile = {}) {
    let adjustment = 0;
    const reasons = [];
    const components = [];

    const addComponent = ({
      component,
      adjustment: componentAdjustment,
      reason,
      stats = null,
      maxPenaltyAllowed = null
    }) => {
      adjustment += componentAdjustment;
      reasons.push(reason);
      components.push({
        component,
        adjustment: componentAdjustment,
        maxPenaltyAllowed,
        weightPercent: null,
        reason,
        stats
      });
    };

    const { symbolStats, hourStats, strategyStats, symbolSignalStats, lossPattern } = profile;

    if (symbolStats?.total >= 8) {
      if (symbolStats.winrate >= 70) {
        addComponent({
          component: "Ativo",
          adjustment: 8,
          reason: "Ativo com histórico forte.",
          stats: symbolStats
        });
      } else if (symbolStats.winrate <= 40) {
        addComponent({
          component: "Ativo",
          adjustment: -10,
          maxPenaltyAllowed: -10,
          reason: "Ativo com histórico fraco.",
          stats: symbolStats
        });
      }
    }

    if (hourStats?.total >= 6) {
      if (hourStats.winrate >= 68) {
        addComponent({
          component: "Horário",
          adjustment: 5,
          reason: "Horário favorável.",
          stats: hourStats
        });
      } else if (hourStats.winrate <= 42) {
        addComponent({
          component: "Horário",
          adjustment: -7,
          maxPenaltyAllowed: -7,
          reason: "Horário com desempenho ruim.",
          stats: hourStats
        });
      }
    }

    if (strategyStats?.total >= 6) {
      if (strategyStats.winrate >= 68) {
        addComponent({
          component: "Estratégia",
          adjustment: 6,
          reason: "Estratégia performando bem.",
          stats: strategyStats
        });
      } else if (strategyStats.winrate <= 42) {
        addComponent({
          component: "Estratégia",
          adjustment: -8,
          maxPenaltyAllowed: -8,
          reason: "Estratégia com baixa performance.",
          stats: strategyStats
        });
      }
    }

    if (symbolSignalStats?.total >= 6 && symbolSignalStats.lossrate >= 65) {
      addComponent({
        component: "Direção do ativo",
        adjustment: -10,
        maxPenaltyAllowed: -10,
        reason: "Direção do ativo com muitos losses.",
        stats: symbolSignalStats
      });
    }

    if (lossPattern?.total >= 4 && lossPattern.lossrate >= 70) {
      addComponent({
        component: "Padrão de loss",
        adjustment: -15,
        maxPenaltyAllowed: -15,
        reason: "Padrão específico com alto índice de loss.",
        stats: lossPattern
      });
    }

    if (lossPattern?.total >= 6 && lossPattern.lossrate >= 80) {
      addComponent({
        component: "Padrão crítico de loss",
        adjustment: -22,
        maxPenaltyAllowed: -22,
        reason: "IA bloqueando padrão crítico de loss.",
        stats: lossPattern
      });
    }

    const rawAdjustment = adjustment;

    return {
      adjustment: clamp(rawAdjustment),
      reasons,
      audit: {
        source: "adaptiveLearning",
        maxPenaltyAllowed: -30,
        maxBonusAllowed: 30,
        rawAdjustment,
        appliedAdjustment: clamp(rawAdjustment),
        clampApplied: rawAdjustment !== clamp(rawAdjustment),
        components
      }
    };
  }

  async applyAdaptiveScore(baseScore, item = {}) {
    const symbol = item.symbol || item.asset || "unknown";
    const signal = item.signal || item.direction || "WAIT";
    const strategyName = item.strategyName || item.strategy_name || item.strategy || "unknown";

    const profile = await this.getLearningProfile(symbol, signal, strategyName, item);
    const learning = this.calculateAdjustment(profile);
    const thresholdLearning = await dynamicThresholdService.learn({
      ...item,
      symbol,
      signal,
      strategyName,
      hour: profile.hour,
      marketRegime: profile.marketRegime
    });

    const rawAdaptiveAdjustment =
      Number(learning.adjustment || 0) + Number(thresholdLearning.adaptiveAdjustment || 0);
    const rampUpLimit = getAdaptiveRampUpLimit(profile.totalHistoricalSignals);
    const adaptiveAdjustment = clamp(rawAdaptiveAdjustment, -rampUpLimit, rampUpLimit);

    const finalScore = Math.max(
      0,
      Math.min(100, Number((Number(baseScore || 0) + adaptiveAdjustment).toFixed(2)))
    );

    return {
      finalScore,
      adaptiveAdjustment,
      adaptiveReasons: [...learning.reasons, ...(thresholdLearning.reasons || [])],
      dynamicThresholds: thresholdLearning,
      adaptiveAdjustmentAudit: {
        maxPenaltyAllowed: -rampUpLimit,
        maxBonusAllowed: rampUpLimit,
        rawAdjustment: rawAdaptiveAdjustment,
        appliedAdjustment: adaptiveAdjustment,
        clampApplied: rawAdaptiveAdjustment !== adaptiveAdjustment,
        rampUp: {
          source: "adaptiveLearningRampUp",
          totalSignals: profile.totalHistoricalSignals,
          maxAbsAdjustment: rampUpLimit
        },
        components: [
          learning.audit,
          thresholdLearning.adaptiveAdjustmentAudit
        ].filter(Boolean)
      },
      learningProfile: {
        hour: profile.hour,
        marketRegime: profile.marketRegime,
        symbol: profile.symbolStats || null,
        hourStats: profile.hourStats || null,
        strategy: profile.strategyStats || null,
        marketRegimeStats: profile.marketRegimeStats || null,
        lossPattern: profile.lossPattern || null,
        thresholdPerformance: thresholdLearning.thresholdPerformance || null,
        totalHistoricalSignals: profile.totalHistoricalSignals,
        adaptiveRampUpLimit: rampUpLimit
      }
    };
  }

  async shouldHardBlock(item = {}) {
    const symbol = item.symbol || item.asset || "unknown";
    const signal = item.signal || item.direction || "WAIT";
    const strategyName = item.strategyName || item.strategy_name || item.strategy || "unknown";
    const mode = item.mode === "conservative" || item.mode === "aggressive" ? item.mode : "balanced";

    const profile = await this.getLearningProfile(symbol, signal, strategyName, item);
    const reasons = [];
    const thresholds = {
      conservative: {
        lossPatternTotal: 6,
        lossPatternRate: 80,
        symbolSignalTotal: 8,
        symbolSignalRate: 75,
        hourTotal: 8,
        hourRate: 75
      },
      balanced: {
        lossPatternTotal: 7,
        lossPatternRate: 86,
        symbolSignalTotal: 10,
        symbolSignalRate: 82,
        hourTotal: 10,
        hourRate: 82
      },
      aggressive: {
        lossPatternTotal: 8,
        lossPatternRate: 92,
        symbolSignalTotal: 12,
        symbolSignalRate: 88,
        hourTotal: 12,
        hourRate: 90
      }
    }[mode];

    if (
      profile.lossPattern?.total >= thresholds.lossPatternTotal &&
      profile.lossPattern.lossrate >= thresholds.lossPatternRate
    ) {
      reasons.push("Padrão severo de loss detectado pela IA.");
    }

    if (
      profile.symbolSignalStats?.total >= thresholds.symbolSignalTotal &&
      profile.symbolSignalStats.lossrate >= thresholds.symbolSignalRate
    ) {
      reasons.push("Ativo e direção com risco extremo historicamente validado.");
    }

    if (
      profile.hourStats?.total >= thresholds.hourTotal &&
      profile.hourStats.lossrate >= thresholds.hourRate
    ) {
      reasons.push("Horário operacional com risco extremo.");
    }

    return {
      blocked: reasons.length > 0,
      reason: reasons.join(" ")
    };
  }
}

module.exports = new AdaptiveService();
module.exports.getAdaptiveRampUpLimit = getAdaptiveRampUpLimit;
