class HistoryService {
  constructor() {
    this.items = [];
    this.maxItems = 200;
  }

  add(entry) {
    const normalized = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: entry.symbol || "N/A",
      signal: entry.signal || "WAIT",
      confidence: Number(entry.confidence || 0),
      explanation: entry.explanation || null,
      reasons: Array.isArray(entry.reasons) ? entry.reasons : [],
      mode: entry.mode || null,
      market: entry.market || null,
      error: entry.error || null,
      timestamp: entry.timestamp || new Date().toISOString()
    };

    this.items.unshift(normalized);

    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(0, this.maxItems);
    }

    return normalized;
  }

  addMany(entries = []) {
    const inserted = [];

    for (const entry of entries) {
      inserted.push(this.add(entry));
    }

    return inserted;
  }

  getLatest(limit = 20) {
    return this.items.slice(0, limit);
  }

  getBySymbol(symbol, limit = 20) {
    return this.items
      .filter((item) => item.symbol === symbol)
      .slice(0, limit);
  }

  getStats() {
    const total = this.items.length;
    const callCount = this.items.filter((item) => item.signal === "CALL").length;
    const putCount = this.items.filter((item) => item.signal === "PUT").length;
    const waitCount = this.items.filter((item) => item.signal === "WAIT").length;

    const avgConfidence =
      total > 0
        ? Number(
            (
              this.items.reduce((acc, item) => acc + Number(item.confidence || 0), 0) /
              total
            ).toFixed(2)
          )
        : 0;

    return {
      total,
      callCount,
      putCount,
      waitCount,
      avgConfidence
    };
  }
}

module.exports = new HistoryService();