const signalRepository = require("../../repositories/signal.repository");
const thresholdRepository = require("./repository");

const MIN_SAMPLE_SIZE = 6;
const STRONG_SAMPLE_SIZE = 12;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function normalizeMode(mode = "balanced") {
  const normalized = String(mode || "balanced").toLowerCase();

  if (["conservador", "conservative"].includes(normalized)) return "conservative";
  if (["agressivo", "aggressive"].includes(normalized)) return "aggressive";

  return "balanced";
}

function getBaseThresholds(mode = "balanced") {
  const profiles = {
    conservative: {
      minimumScore: 78,
      confidence: 78,
      sniperTiming: 90,
      adaptiveAdjustment: 0
    },
    balanced: {
      minimumScore: 68,
      confidence: 68,
      sniperTiming: 86,
      adaptiveAdjustment: 0
    },
    aggressive: {
      minimumScore: 61,
      confidence: 61,
      sniperTiming: 82,
      adaptiveAdjustment: 0
    }
  };

  return profiles[normalizeMode(mode)] || profiles.balanced;
}

function getScopeKey(context = {}) {
  return [
    context.symbol || context.asset || "unknown",
    context.hour ?? new Date().getHours(),
    context.strategyName || context.strategy_name || context.strategy || "unknown",
    context.marketRegime || context.market_regime || "NORMAL",
    normalizeMode(context.mode)
  ].join(":");
}

function getStatsBucketImpact(label, bucket, weight, reasons) {
  const auditBase = {
    component: label,
    weightPercent: round(weight * 100),
    sampleSize: Number(bucket?.total || 0),
    winrate: bucket ? Number(bucket.winrate || 0) : null,
    pressure: 0,
    confidenceMultiplier: 0,
    adaptiveAdjustment: 0,
    reason: "Amostra insuficiente para Dynamic Threshold Learning."
  };

  if (!bucket || Number(bucket.total || 0) < MIN_SAMPLE_SIZE) {
    return {
      minimumScore: 0,
      confidence: 0,
      sniperTiming: 0,
      adaptiveAdjustment: 0,
      audit: auditBase
    };
  }

  const total = Number(bucket.total || 0);
  const winrate = Number(bucket.winrate || 0);
  const confidenceMultiplier = total >= STRONG_SAMPLE_SIZE ? 1 : 0.65;
  let pressure = 0;

  if (winrate >= 76) pressure = -4;
  else if (winrate >= 68) pressure = -2;
  else if (winrate <= 34) pressure = 6;
  else if (winrate <= 42) pressure = 4;
  else if (winrate <= 48) pressure = 2;

  if (!pressure) {
    return {
      minimumScore: 0,
      confidence: 0,
      sniperTiming: 0,
      adaptiveAdjustment: 0,
      audit: {
        ...auditBase,
        confidenceMultiplier,
        reason: `Sem pressão adaptativa: winrate ${winrate}% em ${total} sinais.`
      }
    };
  }

  const direction = pressure > 0 ? "defensivo" : "oportunista";
  const reason = `${label} ${direction}: winrate ${winrate}% em ${total} sinais.`;
  reasons.push(reason);
  const adaptiveAdjustment = -pressure * weight * 1.15 * confidenceMultiplier;

  return {
    minimumScore: pressure * weight * confidenceMultiplier,
    confidence: pressure * weight * 0.85 * confidenceMultiplier,
    sniperTiming: pressure * weight * 0.55 * confidenceMultiplier,
    adaptiveAdjustment,
    audit: {
      ...auditBase,
      pressure,
      confidenceMultiplier,
      adaptiveAdjustment: round(adaptiveAdjustment),
      reason
    }
  };
}

function aggregatePerformance(buckets = []) {
  const aggregate = buckets.reduce(
    (acc, bucket) => {
      if (!bucket) return acc;

      acc.total += Number(bucket.total || 0);
      acc.wins += Number(bucket.wins || 0);
      acc.losses += Number(bucket.losses || 0);
      return acc;
    },
    { total: 0, wins: 0, losses: 0 }
  );

  aggregate.winrate = aggregate.total
    ? round((aggregate.wins / aggregate.total) * 100)
    : 0;
  aggregate.lossrate = aggregate.total
    ? round((aggregate.losses / aggregate.total) * 100)
    : 0;

  return aggregate;
}

function buildThresholdChanges(base, learned, reasons, context) {
  return ["minimumScore", "confidence", "sniperTiming", "adaptiveAdjustment"]
    .map((thresholdName) => {
      const previousValue = Number(base[thresholdName] || 0);
      const newValue = Number(learned[thresholdName] || 0);
      const delta = round(newValue - previousValue);

      if (Math.abs(delta) < 0.01) return null;

      return {
        scopeType: "composite",
        scopeKey: getScopeKey(context),
        thresholdName,
        previousValue,
        newValue,
        delta,
        reason: reasons.join(" ") || "Dynamic Threshold Learning recalibrou o limiar.",
        context
      };
    })
    .filter(Boolean);
}

class DynamicThresholdService {
  getBaseThresholds(mode) {
    return getBaseThresholds(mode);
  }

  async getPerformanceProfile(context = {}) {
    const stats = await signalRepository.getStats();
    const hour = context.hour ?? new Date().getHours();
    const symbol = context.symbol || context.asset || "unknown";
    const strategyName =
      context.strategyName ||
      context.strategy_name ||
      context.strategy ||
      "unknown";
    const marketRegime = context.marketRegime || context.market_regime || "NORMAL";

    return {
      hour,
      symbolStats: stats.bySymbol?.[symbol] || null,
      hourStats: stats.byHour?.[hour] || null,
      strategyStats: stats.byStrategy?.[strategyName] || null,
      marketRegimeStats: stats.byMarketRegime?.[marketRegime] || null,
      globalStats: stats.global || null
    };
  }

  calculateThresholds(context = {}, profile = {}, baseThresholds = null) {
    const mode = normalizeMode(context.mode);
    const base = baseThresholds || getBaseThresholds(mode);
    const reasons = [];
    const impacts = [
      getStatsBucketImpact("Ativo", profile.symbolStats, 0.34, reasons),
      getStatsBucketImpact("Horário", profile.hourStats, 0.24, reasons),
      getStatsBucketImpact("Estratégia", profile.strategyStats, 0.28, reasons),
      getStatsBucketImpact("Regime de mercado", profile.marketRegimeStats, 0.30, reasons)
    ];

    const totalImpact = impacts.reduce(
      (acc, impact) => ({
        minimumScore: acc.minimumScore + impact.minimumScore,
        confidence: acc.confidence + impact.confidence,
        sniperTiming: acc.sniperTiming + impact.sniperTiming,
        adaptiveAdjustment: acc.adaptiveAdjustment + impact.adaptiveAdjustment
      }),
      { minimumScore: 0, confidence: 0, sniperTiming: 0, adaptiveAdjustment: 0 }
    );
    const rawAdaptiveAdjustment = round(base.adaptiveAdjustment + totalImpact.adaptiveAdjustment);

    const learned = {
      minimumScore: round(clamp(base.minimumScore + totalImpact.minimumScore, 58, 88)),
      confidence: round(clamp(base.confidence + totalImpact.confidence, 58, 90)),
      sniperTiming: round(clamp(base.sniperTiming + totalImpact.sniperTiming, 78, 94)),
      adaptiveAdjustment: round(clamp(rawAdaptiveAdjustment, -18, 14))
    };
    const adaptiveAdjustmentAudit = {
      source: "dynamicThreshold",
      maxPenaltyAllowed: -18,
      maxBonusAllowed: 14,
      rawAdjustment: rawAdaptiveAdjustment,
      appliedAdjustment: learned.adaptiveAdjustment,
      clampApplied: rawAdaptiveAdjustment !== learned.adaptiveAdjustment,
      components: impacts.map((impact) => impact.audit)
    };

    const thresholdPerformance = aggregatePerformance([
      profile.symbolStats,
      profile.hourStats,
      profile.strategyStats,
      profile.marketRegimeStats
    ]);

    const thresholdChanges = buildThresholdChanges(base, learned, reasons, context);
    const thresholdHistory = {
      scopeType: "composite",
      scopeKey: getScopeKey(context),
      symbol: context.symbol || context.asset || null,
      hour: profile.hour ?? context.hour ?? new Date().getHours(),
      strategyName: context.strategyName || context.strategy_name || context.strategy || null,
      marketRegime: context.marketRegime || context.market_regime || "NORMAL",
      mode,
      ...learned,
      performanceSnapshot: {
        symbol: profile.symbolStats,
        hour: profile.hourStats,
        strategy: profile.strategyStats,
        marketRegime: profile.marketRegimeStats,
        global: profile.globalStats
      },
      adaptiveAdjustmentAudit,
      reasons
    };

    return {
      ...learned,
      reasons,
      profile,
      adaptiveAdjustmentAudit,
      thresholdHistory,
      thresholdChanges,
      thresholdPerformance
    };
  }

  async learn(context = {}) {
    const mode = normalizeMode(context.mode);
    const normalizedContext = {
      ...context,
      mode,
      hour: context.hour ?? new Date().getHours(),
      marketRegime: context.marketRegime || context.market_regime || "NORMAL"
    };
    const profile = await this.getPerformanceProfile(normalizedContext);
    const learned = this.calculateThresholds(
      normalizedContext,
      profile,
      getBaseThresholds(mode)
    );

    this.persistLearning(learned, normalizedContext).catch((error) => {
      console.error("Erro ao persistir Dynamic Threshold Learning:", error.message || error);
    });

    return learned;
  }

  async persistLearning(learning, context = {}) {
    const history = await thresholdRepository.saveThresholdHistory(learning.thresholdHistory);

    await Promise.all(
      learning.thresholdChanges.map((change) => thresholdRepository.saveThresholdChange(change))
    );

    await thresholdRepository.upsertThresholdPerformance({
      scopeType: "composite",
      scopeKey: getScopeKey(context),
      symbol: context.symbol || context.asset || null,
      hour: context.hour ?? null,
      strategyName: context.strategyName || context.strategy_name || context.strategy || null,
      marketRegime: context.marketRegime || context.market_regime || "NORMAL",
      ...learning.thresholdPerformance,
      lastThresholds: {
        minimumScore: learning.minimumScore,
        confidence: learning.confidence,
        sniperTiming: learning.sniperTiming,
        adaptiveAdjustment: learning.adaptiveAdjustment
      }
    });

    return history;
  }
}

module.exports = new DynamicThresholdService();
