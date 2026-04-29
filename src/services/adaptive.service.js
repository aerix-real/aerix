const signalRepository = require("../repositories/signal.repository");

function clamp(value, min = -30, max = 30) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function winRate(wins, total) {
  if (!total) return 0;
  return Number(((Number(wins || 0) / Number(total || 0)) * 100).toFixed(2));
}

class AdaptiveService {
  async getLearningProfile(symbol, signal = "WAIT", strategyName = "unknown") {
    const stats = await signalRepository.getStats();
    const hour = new Date().getHours();

    const symbolStats = stats.bySymbol?.[symbol];
    const hourStats = stats.byHour?.[hour];
    const strategyStats = stats.byStrategy?.[strategyName];
    const symbolSignalStats = stats.bySymbolSignal?.[`${symbol}:${signal}`];
    const lossPattern = stats.lossPatterns?.[`${symbol}:${signal}:${strategyName}:${hour}`];

    return {
      hour,
      symbolStats,
      hourStats,
      strategyStats,
      symbolSignalStats,
      lossPattern
    };
  }

  calculateAdjustment(profile = {}) {
    let adjustment = 0;
    const reasons = [];

    const { symbolStats, hourStats, strategyStats, symbolSignalStats, lossPattern } = profile;

    if (symbolStats?.total >= 8) {
      if (symbolStats.winrate >= 70) {
        adjustment += 8;
        reasons.push("Ativo com histórico forte.");
      } else if (symbolStats.winrate <= 40) {
        adjustment -= 10;
        reasons.push("Ativo com histórico fraco.");
      }
    }

    if (hourStats?.total >= 6) {
      if (hourStats.winrate >= 68) {
        adjustment += 5;
        reasons.push("Horário favorável.");
      } else if (hourStats.winrate <= 42) {
        adjustment -= 7;
        reasons.push("Horário com desempenho ruim.");
      }
    }

    if (strategyStats?.total >= 6) {
      if (strategyStats.winrate >= 68) {
        adjustment += 6;
        reasons.push("Estratégia performando bem.");
      } else if (strategyStats.winrate <= 42) {
        adjustment -= 8;
        reasons.push("Estratégia com baixa performance.");
      }
    }

    if (symbolSignalStats?.total >= 6 && symbolSignalStats.lossrate >= 65) {
      adjustment -= 10;
      reasons.push("Direção do ativo com muitos losses.");
    }

    if (lossPattern?.total >= 4 && lossPattern.lossrate >= 70) {
      adjustment -= 15;
      reasons.push("Padrão específico com alto índice de loss.");
    }

    if (lossPattern?.total >= 6 && lossPattern.lossrate >= 80) {
      adjustment -= 22;
      reasons.push("IA bloqueando padrão crítico de loss.");
    }

    return {
      adjustment: clamp(adjustment),
      reasons
    };
  }

  async applyAdaptiveScore(baseScore, item = {}) {
    const symbol = item.symbol || item.asset || "unknown";
    const signal = item.signal || item.direction || "WAIT";
    const strategyName = item.strategyName || item.strategy_name || item.strategy || "unknown";

    const profile = await this.getLearningProfile(symbol, signal, strategyName);
    const learning = this.calculateAdjustment(profile);

    const finalScore = Math.max(
      0,
      Math.min(100, Number((Number(baseScore || 0) + learning.adjustment).toFixed(2)))
    );

    return {
      finalScore,
      adaptiveAdjustment: learning.adjustment,
      adaptiveReasons: learning.reasons,
      learningProfile: {
        hour: profile.hour,
        symbol: profile.symbolStats || null,
        hourStats: profile.hourStats || null,
        strategy: profile.strategyStats || null,
        lossPattern: profile.lossPattern || null
      }
    };
  }

  async shouldHardBlock(item = {}) {
    const symbol = item.symbol || item.asset || "unknown";
    const signal = item.signal || item.direction || "WAIT";
    const strategyName = item.strategyName || item.strategy_name || item.strategy || "unknown";

    const profile = await this.getLearningProfile(symbol, signal, strategyName);
    const reasons = [];

    if (profile.lossPattern?.total >= 6 && profile.lossPattern.lossrate >= 80) {
      reasons.push("Padrão crítico de loss detectado pela IA.");
    }

    if (profile.symbolSignalStats?.total >= 8 && profile.symbolSignalStats.lossrate >= 75) {
      reasons.push("Ativo e direção com histórico altamente desfavorável.");
    }

    if (profile.hourStats?.total >= 8 && profile.hourStats.lossrate >= 75) {
      reasons.push("Horário operacional com risco extremo.");
    }

    return {
      blocked: reasons.length > 0,
      reason: reasons.join(" ")
    };
  }
}

module.exports = new AdaptiveService();