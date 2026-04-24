const signalRepository = require("../repositories/signal.repository");

class HistoryService {
  async add(entry) {
    const expiryAt = entry.expiryAt
      ? new Date(entry.expiryAt)
      : entry.currentSignal?.expiration
        ? this.parseTimeToFutureDate(entry.currentSignal.expiration)
        : null;

    return await signalRepository.insertSignal({
      user_id: entry.userId || 1,
      symbol: entry.symbol,
      signal: entry.signal,
      confidence: entry.confidence,
      final_score: entry.finalScore,
      entry_quality: entry.entryQuality,
      strategy_name: entry.strategyName,
      mode: entry.strategyMode,
      trend_direction:
        entry.currentSignal?.trendDirection ||
        entry.market?.h1?.direction ||
        "neutral",
      trend_strength:
        entry.currentSignal?.trendStrength ||
        entry.market?.h1?.strengthPercent ||
        0,
      volatility:
        entry.currentSignal?.volatility ||
        entry.market?.m5?.volatilityPercent ||
        0,
      entry_price:
        entry.currentSignal?.price ??
        entry.market?.m5?.candles?.[entry.market?.m5?.candles?.length - 1]?.close ??
        null,
      expires_at: expiryAt,

      // 🔥 NOVO (compatível com IA)
      blocked: entry.blocked ?? false,
      block_reason: entry.blockReason ?? null,
      explanation: entry.explanation ?? null
    });
  }

  async addMany(entries = []) {
    const inserted = [];

    for (const entry of entries) {
      try {
        inserted.push(await this.add(entry));
      } catch (_) {
        // não derruba o ciclo
      }
    }

    return inserted;
  }

  async getLatest(limit = 20) {
    return await signalRepository.getLatest(limit);
  }

  // ==============================
  // 🧠 IA REAL (AGORA FUNCIONA)
  // ==============================
  async getStats() {
    const rows = await signalRepository.getStats();

    const stats = {
      bySymbol: {},
      byHour: {},
      byStrategy: {}
    };

    for (const row of rows) {
      const symbol = row.symbol;
      const hour = new Date(row.created_at).getHours();
      const strategy = row.strategy_name || "unknown";

      const win = row.result === "WIN" ? 1 : 0;

      // ===== SYMBOL =====
      if (!stats.bySymbol[symbol]) {
        stats.bySymbol[symbol] = { total: 0, wins: 0, winrate: 0 };
      }

      stats.bySymbol[symbol].total++;
      stats.bySymbol[symbol].wins += win;

      // ===== HOUR =====
      if (!stats.byHour[hour]) {
        stats.byHour[hour] = { total: 0, wins: 0, winrate: 0 };
      }

      stats.byHour[hour].total++;
      stats.byHour[hour].wins += win;

      // ===== STRATEGY =====
      if (!stats.byStrategy[strategy]) {
        stats.byStrategy[strategy] = { total: 0, wins: 0, winrate: 0 };
      }

      stats.byStrategy[strategy].total++;
      stats.byStrategy[strategy].wins += win;
    }

    // calcular winrate
    for (const key of Object.keys(stats.bySymbol)) {
      const s = stats.bySymbol[key];
      s.winrate = s.total ? Math.round((s.wins / s.total) * 100) : 0;
    }

    for (const key of Object.keys(stats.byHour)) {
      const s = stats.byHour[key];
      s.winrate = s.total ? Math.round((s.wins / s.total) * 100) : 0;
    }

    for (const key of Object.keys(stats.byStrategy)) {
      const s = stats.byStrategy[key];
      s.winrate = s.total ? Math.round((s.wins / s.total) * 100) : 0;
    }

    return stats;
  }

  parseTimeToFutureDate(timeString) {
    if (!timeString || typeof timeString !== "string" || !timeString.includes(":")) {
      return null;
    }

    const now = new Date();
    const target = new Date();
    const [hh, mm, ss] = timeString.split(":").map(Number);

    target.setHours(hh ?? 0, mm ?? 0, ss ?? 0, 0);

    if (target < now) {
      target.setDate(target.getDate() + 1);
    }

    return target;
  }
}

module.exports = new HistoryService();