const RateLimiterService = require("./rate-limiter.service");
const cacheService = require("./cache.service");
const { getMarketSnapshot } = require("./market-data.service");
const { analyzeSymbolForUser } = require("./engine.service");
const historyService = require("./history.service");
const { emitToAll } = require("../websocket/socket");
const runtimeConfig = require("../config/runtime");

class EngineRunnerService {
  constructor() {
    this.timer = null;
    this.isRunning = false;
    this.isProcessing = false;
    this.currentIndex = 0;
    this.lastCycleAt = null;
    this.bestOpportunity = null;
    this.latestResults = [];
    this.lastStatus = "idle";
    this.lastStartedAt = null;

    this.rateLimiter = new RateLimiterService({
      maxPerMinute: runtimeConfig.MAX_REQUESTS_PER_MINUTE
    });
  }

  getTrackedSymbols() {
    const configured = Array.isArray(runtimeConfig.DEFAULT_SYMBOLS)
      ? runtimeConfig.DEFAULT_SYMBOLS.filter(Boolean)
      : [];

    return configured.length ? configured : ["EUR/USD", "GBP/USD"];
  }

  pickSymbolsForCycle() {
    const symbols = this.getTrackedSymbols();

    if (!symbols.length) return [];

    const count = Math.max(
      1,
      Math.min(runtimeConfig.MAX_SYMBOLS_PER_CYCLE || 1, symbols.length)
    );

    const selected = [];

    for (let i = 0; i < count; i += 1) {
      const index = (this.currentIndex + i) % symbols.length;
      selected.push(symbols[index]);
    }

    this.currentIndex = (this.currentIndex + count) % symbols.length;

    return selected;
  }

  async analyzeSymbol(symbol) {
    const snapshot = await getMarketSnapshot(symbol);

    this.rateLimiter.register(3);

    const analysis = await analyzeSymbolForUser(1, symbol, snapshot);

    return {
      ...analysis,
      snapshotTimestamp: snapshot.timestamp
    };
  }

  calculateOpportunityScore(item) {
    if (!item) return -9999;

    let score = Number(item.confidence || 0);

    if (item.signal === "WAIT") score -= 25;

    const entryQuality = String(item.entryQuality || "").toLowerCase();
    if (entryQuality === "excellent") score += 10;
    else if (entryQuality === "strong") score += 7;
    else if (entryQuality === "good") score += 4;
    else if (entryQuality === "weak") score -= 8;

    const reasonsCount = Array.isArray(item.reasons) ? item.reasons.length : 0;
    const blocksCount = Array.isArray(item.blocks) ? item.blocks.length : 0;

    score += Math.min(reasonsCount, 5) * 1.5;
    score -= Math.min(blocksCount, 5) * 3;

    const mtf = item.mtf || {};
    const h1Aligned =
      mtf.h1?.aligned === true ||
      mtf.h1?.isAligned === true ||
      mtf.h1?.trendAligned === true;
    const m15Aligned =
      mtf.m15?.aligned === true ||
      mtf.m15?.isAligned === true ||
      mtf.m15?.trendAligned === true;
    const m5Aligned =
      mtf.m5?.aligned === true ||
      mtf.m5?.isAligned === true ||
      mtf.m5?.trendAligned === true;

    if (h1Aligned) score += 4;
    if (m15Aligned) score += 3;
    if (m5Aligned) score += 2;

    if (item.error) score -= 30;

    return Number(score.toFixed(2));
  }

  selectBestOpportunity(results = []) {
    if (!Array.isArray(results) || !results.length) return null;

    const ranked = results
      .map((item) => ({
        ...item,
        finalScore: this.calculateOpportunityScore(item)
      }))
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    return ranked[0] || null;
  }

  updateState(results) {
    const mergedMap = new Map();

    for (const current of this.latestResults) {
      mergedMap.set(current.symbol, current);
    }

    for (const next of results) {
      mergedMap.set(next.symbol, next);
    }

    this.latestResults = Array.from(mergedMap.values())
      .map((item) => ({
        ...item,
        finalScore: this.calculateOpportunityScore(item)
      }))
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    this.bestOpportunity = this.selectBestOpportunity(this.latestResults);
    this.lastCycleAt = new Date().toISOString();
    this.lastStatus = "running";

    historyService.addMany(results);

    cacheService.set(
      "runtime:state",
      this.getState(),
      (runtimeConfig.ENGINE_INTERVAL_MS || 15000) * 2
    );
  }

  emitRuntime(results) {
    const payload = {
      status: this.isRunning ? "running" : "stopped",
      bestOpportunity: this.bestOpportunity,
      results: this.latestResults,
      history: historyService.getLatest(8),
      historyStats: historyService.getStats(),
      lastCycleAt: this.lastCycleAt,
      rateLimit: this.rateLimiter.getStats(),
      cycleUpdatedSymbols: results.map((item) => item.symbol),
      timestamp: new Date().toISOString()
    };

    emitToAll("engine:update", payload);
  }

  async processCycle() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.lastStatus = "processing";

    try {
      const selectedSymbols = this.pickSymbolsForCycle();

      if (!selectedSymbols.length) {
        this.lastStatus = "idle";
        return;
      }

      const estimatedRequests = selectedSymbols.length * 3;

      if (!this.rateLimiter.canProceed(estimatedRequests)) {
        this.lastStatus = "rate_limited";

        emitToAll("engine:status", {
          status: "rate_limited",
          message: "Limite de API por minuto atingido. Aguardando próxima janela.",
          rateLimit: this.rateLimiter.getStats(),
          timestamp: new Date().toISOString()
        });

        return;
      }

      const cycleResults = [];

      for (const symbol of selectedSymbols) {
        try {
          const result = await this.analyzeSymbol(symbol);
          cycleResults.push(result);
        } catch (error) {
          cycleResults.push({
            symbol,
            signal: "WAIT",
            confidence: 0,
            finalScore: 0,
            entryQuality: "weak",
            strategyName: null,
            reasons: [],
            blocks: [error.message || "Erro ao processar ativo."],
            explanation: error.message || "Erro ao processar ativo.",
            error: error.message || "Erro ao processar ativo.",
            timestamp: new Date().toISOString()
          });
        }
      }

      this.updateState(cycleResults);
      this.emitRuntime(cycleResults);
    } finally {
      this.isProcessing = false;

      if (this.isRunning && this.lastStatus !== "rate_limited") {
        this.lastStatus = "running";
      }
    }
  }

  start() {
    if (this.isRunning) {
      return this.getState();
    }

    this.isRunning = true;
    this.lastStatus = "running";
    this.lastStartedAt = new Date().toISOString();

    this.timer = setInterval(async () => {
      await this.processCycle();
    }, runtimeConfig.ENGINE_INTERVAL_MS || 15000);

    this.processCycle().catch(() => {});

    emitToAll("engine:status", {
      status: "running",
      message: "Engine iniciada com sucesso.",
      timestamp: new Date().toISOString()
    });

    return this.getState();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.isRunning = false;
    this.lastStatus = "stopped";

    emitToAll("engine:status", {
      status: "stopped",
      message: "Engine parada com sucesso.",
      timestamp: new Date().toISOString()
    });

    return this.getState();
  }

  async runNow() {
    await this.processCycle();
    return this.getState();
  }

  getState() {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      currentIndex: this.currentIndex,
      trackedSymbols: this.getTrackedSymbols(),
      bestOpportunity: this.bestOpportunity,
      latestResults: this.latestResults,
      history: historyService.getLatest(12),
      historyStats: historyService.getStats(),
      lastCycleAt: this.lastCycleAt,
      lastStartedAt: this.lastStartedAt,
      lastStatus: this.lastStatus,
      intervalMs: runtimeConfig.ENGINE_INTERVAL_MS,
      rateLimit: this.rateLimiter.getStats()
    };
  }
}

module.exports = new EngineRunnerService();