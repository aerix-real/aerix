const RateLimiterService = require("./rate-limiter.service");
const cacheService = require("./cache.service");
const { getMarketSnapshot } = require("./market-data.service");
const { analyzeSymbolForUser } = require("./engine.service");
const historyService = require("./history.service");
const resultCheckerService = require("./result-checker.service");
const executionService = require("./execution.service");
const { emitToAll } = require("../websocket/socket");
const runtimeConfig = require("../config/runtime");

class EngineRunnerService {
  constructor() {
    this.timer = null;
    this.resultTimer = null;
    this.isRunning = false;
    this.isProcessing = false;
    this.currentIndex = 0;
    this.bestOpportunity = null;
    this.latestResults = [];
    this.historyStats = null;

    this.rateLimiter = new RateLimiterService({
      maxPerMinute: runtimeConfig.MAX_REQUESTS_PER_MINUTE
    });
  }

  getTrackedSymbols() {
    return runtimeConfig.DEFAULT_SYMBOLS || ["EUR/USD", "GBP/USD"];
  }

  getAdaptiveScore(item) {
    if (!this.historyStats) return 0;

    let adjustment = 0;

    const symbolStats = this.historyStats.bySymbol?.[item.symbol];
    const hour = new Date().getHours();
    const hourStats = this.historyStats.byHour?.[hour];
    const strategyStats = this.historyStats.byStrategy?.[item.strategyName];

    if (symbolStats?.total >= 5) {
      if (symbolStats.winrate >= 70) adjustment += 6;
      else if (symbolStats.winrate <= 40) adjustment -= 6;
    }

    if (hourStats?.total >= 5) {
      if (hourStats.winrate >= 70) adjustment += 4;
      else if (hourStats.winrate <= 40) adjustment -= 4;
    }

    if (strategyStats?.total >= 5) {
      if (strategyStats.winrate >= 70) adjustment += 5;
      else if (strategyStats.winrate <= 40) adjustment -= 5;
    }

    return adjustment;
  }

  getLossLearningPenalty(item) {
    if (!this.historyStats || !item) return 0;

    let penalty = 0;

    const hour = new Date().getHours();
    const symbol = item.symbol || "unknown";
    const signal = item.signal || "WAIT";
    const strategy = item.strategyName || "unknown";

    const symbolSignalKey = `${symbol}:${signal}`;
    const lossPatternKey = `${symbol}:${signal}:${strategy}:${hour}`;

    const symbolSignalStats = this.historyStats.bySymbolSignal?.[symbolSignalKey];
    const lossPattern = this.historyStats.lossPatterns?.[lossPatternKey];

    if (symbolSignalStats?.total >= 6 && symbolSignalStats.lossrate >= 65) {
      penalty -= 8;
    }

    if (lossPattern?.total >= 4 && lossPattern.lossrate >= 70) {
      penalty -= 12;
    }

    if (lossPattern?.total >= 6 && lossPattern.lossrate >= 80) {
      penalty -= 18;
    }

    return penalty;
  }

  getLatestCandles(item) {
    return (
      item.market?.m5?.candles ||
      item.market?.m1?.candles ||
      item.snapshot?.m5?.candles ||
      item.snapshot?.candles ||
      []
    );
  }

  analyzeCandlePattern(item) {
    const candles = this.getLatestCandles(item);

    if (!Array.isArray(candles) || candles.length < 2) {
      return {
        candlePattern: "sem_dados",
        candleBias: "neutral",
        candleScore: 0,
        candleRisk: "unknown",
        candleExplanation: "Sem candles suficientes para leitura."
      };
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    const open = Number(last.open);
    const high = Number(last.high);
    const low = Number(last.low);
    const close = Number(last.close);
    const prevOpen = Number(prev.open);
    const prevClose = Number(prev.close);

    if (![open, high, low, close, prevOpen, prevClose].every(Number.isFinite)) {
      return {
        candlePattern: "dados_invalidos",
        candleBias: "neutral",
        candleScore: 0,
        candleRisk: "unknown",
        candleExplanation: "Dados do candle inválidos."
      };
    }

    const range = Math.max(high - low, 0.000001);
    const body = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;

    const bodyPercent = body / range;
    const upperPercent = upperWick / range;
    const lowerPercent = lowerWick / range;

    const isBullish = close > open;
    const isBearish = close < open;
    const prevBullish = prevClose > prevOpen;
    const prevBearish = prevClose < prevOpen;

    let candlePattern = "neutro";
    let candleBias = "neutral";
    let candleScore = 0;
    let candleRisk = "medium";
    let candleExplanation = "Candle neutro, sem força clara.";

    if (bodyPercent < 0.18) {
      candlePattern = "doji_indecisao";
      candleRisk = "high";
      candleScore -= 8;
      candleExplanation = "Candle de indecisão detectado; mercado sem direção clara.";
    } else if (isBullish && bodyPercent >= 0.55) {
      candlePattern = "candle_alta_dominante";
      candleBias = "CALL";
      candleRisk = "low";
      candleScore += 8;
      candleExplanation = "Candle comprador dominante, indicando pressão de alta.";
    } else if (isBearish && bodyPercent >= 0.55) {
      candlePattern = "candle_baixa_dominante";
      candleBias = "PUT";
      candleRisk = "low";
      candleScore += 8;
      candleExplanation = "Candle vendedor dominante, indicando pressão de baixa.";
    }

    if (lowerPercent >= 0.45 && isBullish) {
      candlePattern = "rejeicao_fundo";
      candleBias = "CALL";
      candleRisk = "low";
      candleScore += 10;
      candleExplanation = "Rejeição forte no fundo; compradores defenderam a região.";
    }

    if (upperPercent >= 0.45 && isBearish) {
      candlePattern = "rejeicao_topo";
      candleBias = "PUT";
      candleRisk = "low";
      candleScore += 10;
      candleExplanation = "Rejeição forte no topo; vendedores defenderam a região.";
    }

    if (isBullish && prevBearish && close > prevOpen && open < prevClose) {
      candlePattern = "engolfo_alta";
      candleBias = "CALL";
      candleRisk = "low";
      candleScore += 12;
      candleExplanation = "Engolfo de alta detectado; possível reversão compradora.";
    }

    if (isBearish && prevBullish && close < prevOpen && open > prevClose) {
      candlePattern = "engolfo_baixa";
      candleBias = "PUT";
      candleRisk = "low";
      candleScore += 12;
      candleExplanation = "Engolfo de baixa detectado; possível reversão vendedora.";
    }

    if (upperPercent > 0.45 && lowerPercent > 0.35) {
      candlePattern = "pavio_duplo_indecisao";
      candleBias = "neutral";
      candleRisk = "high";
      candleScore -= 10;
      candleExplanation = "Pavios dos dois lados indicam briga forte e baixa previsibilidade.";
    }

    return {
      candlePattern,
      candleBias,
      candleScore,
      candleRisk,
      candleExplanation,
      candleMetrics: {
        bodyPercent: Number((bodyPercent * 100).toFixed(2)),
        upperWickPercent: Number((upperPercent * 100).toFixed(2)),
        lowerWickPercent: Number((lowerPercent * 100).toFixed(2))
      }
    };
  }

  calculateOpportunityScore(item) {
    if (!item) return -9999;

    let score = Number(item.finalScore || item.confidence || 0);

    if (item.signal === "WAIT") score -= 30;

    const entryQuality = String(item.entryQuality || "").toLowerCase();

    if (entryQuality === "institutional") score += 12;
    else if (entryQuality === "excellent") score += 10;
    else if (entryQuality === "strong") score += 7;
    else if (entryQuality === "good") score += 4;
    else if (entryQuality === "weak") score -= 10;

    const reasons = item.reasons?.length || 0;
    const blocks = item.blocks?.length || 0;

    score += Math.min(reasons, 5) * 2;
    score -= Math.min(blocks, 5) * 4;

    const mtf = item.mtf || {};

    if (mtf.h1?.aligned) score += 5;
    if (mtf.m15?.aligned) score += 4;
    if (mtf.m5?.aligned) score += 3;

    score += this.getAdaptiveScore(item);
    score += this.getLossLearningPenalty(item);

    if (item.candleAnalysis) {
      score += Number(item.candleAnalysis.candleScore || 0);

      if (
        item.candleAnalysis.candleBias !== "neutral" &&
        item.signal !== "WAIT" &&
        item.candleAnalysis.candleBias !== item.signal
      ) {
        score -= 14;
      }
    }

    if (item.error) score -= 40;

    return Number(score.toFixed(2));
  }

  getCandleTiming() {
    const now = Date.now();
    const timeframeSec = 60;
    const seconds = Math.floor(now / 1000) % timeframeSec;
    const secondsToClose = timeframeSec - seconds;

    if (secondsToClose <= 3) {
      return {
        timing: "ENTRAR AGORA",
        entryInSeconds: 0,
        mode: "SNIPER",
        confidence: "MAXIMA"
      };
    }

    if (secondsToClose <= 10) {
      return {
        timing: "PREPARAR ENTRADA",
        entryInSeconds: secondsToClose,
        mode: "SNIPER",
        confidence: "ALTA"
      };
    }

    if (secondsToClose >= 50) {
      return {
        timing: "INICIO DE VELA",
        entryInSeconds: 0,
        mode: "EARLY",
        confidence: "BOA"
      };
    }

    return {
      timing: "AGUARDAR",
      entryInSeconds: secondsToClose,
      mode: "NEUTRO",
      confidence: "MEDIA"
    };
  }

  shouldBlockTrade(item) {
    if (!item) return { blocked: true, reason: "Sem dados" };

    const reasons = [];

    if (item.finalScore < 60) reasons.push("Score baixo");

    if (item.volatility !== undefined && item.volatility < 0.3) {
      reasons.push("Baixa volatilidade");
    }

    const symbolStats = this.historyStats?.bySymbol?.[item.symbol];

    if (symbolStats?.total >= 8 && symbolStats.winrate < 45) {
      reasons.push("Histórico desfavorável");
    }

    const mtf = item.mtf || {};
    const alignedCount =
      (mtf.h1?.aligned ? 1 : 0) +
      (mtf.m15?.aligned ? 1 : 0) +
      (mtf.m5?.aligned ? 1 : 0);

    if (alignedCount < 2) {
      reasons.push("Falta de alinhamento MTF");
    }

    if ((item.blocks?.length || 0) >= 3) {
      reasons.push("Conflitos no sinal");
    }

    if (item.candleAnalysis?.candleRisk === "high") {
      reasons.push("Candle de alto risco");
    }

    if (
      item.candleAnalysis?.candleBias !== "neutral" &&
      item.signal !== "WAIT" &&
      item.candleAnalysis?.candleBias !== item.signal
    ) {
      reasons.push("Candle contra o sinal");
    }

    const hour = new Date().getHours();
    const symbol = item.symbol || "unknown";
    const signal = item.signal || "WAIT";
    const strategy = item.strategyName || "unknown";
    const lossPatternKey = `${symbol}:${signal}:${strategy}:${hour}`;
    const lossPattern = this.historyStats?.lossPatterns?.[lossPatternKey];

    if (lossPattern?.total >= 4 && lossPattern.lossrate >= 70) {
      reasons.push("Padrão recente com alto índice de loss");
    }

    if (reasons.length > 0) {
      return {
        blocked: true,
        reason: reasons.join(", ")
      };
    }

    return { blocked: false };
  }

  generateExplanation(item) {
    if (!item) return "Sem dados suficientes.";

    if (item.blocked) {
      return `🚫 Entrada bloqueada: ${item.blockReason}`;
    }

    const parts = [];

    if (item.signal === "CALL") {
      parts.push("Tendência de alta identificada.");
    } else if (item.signal === "PUT") {
      parts.push("Tendência de baixa identificada.");
    } else {
      return "Mercado indefinido, aguardando melhor oportunidade.";
    }

    const mtf = item.mtf || {};

    if (mtf.h1?.aligned) parts.push("H1 alinhado.");
    if (mtf.m15?.aligned) parts.push("M15 confirma.");
    if (mtf.m5?.aligned) parts.push("M5 indica entrada.");

    if (item.candleAnalysis?.candleExplanation) {
      parts.push(item.candleAnalysis.candleExplanation);
    }

    const adaptive = this.getAdaptiveScore(item);
    const lossPenalty = this.getLossLearningPenalty(item);

    if (adaptive > 0) parts.push("Histórico favorece este cenário.");
    if (adaptive < 0) parts.push("Histórico reduz a confiança deste cenário.");
    if (lossPenalty < 0) parts.push("IA reduziu a pontuação por padrões anteriores de loss.");

    if (item.finalScore >= 80) {
      parts.push("Forte confluência institucional.");
    } else if (item.finalScore < 60) {
      parts.push("Confluência fraca.");
    }

    return parts.join(" ");
  }

  selectBestOpportunity(results = []) {
    if (!Array.isArray(results) || !results.length) return null;

    return results
      .map((item) => ({
        ...item,
        finalScore: this.calculateOpportunityScore(item)
      }))
      .sort((a, b) => b.finalScore - a.finalScore)[0];
  }

  async processCycle() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const symbols = this.getTrackedSymbols();
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

      const estimatedRequests = selected.length * 3;

      if (!this.rateLimiter.canProceed(estimatedRequests)) {
        emitToAll("engine:status", {
          status: "rate_limited",
          message: "Limite de API atingido. Aguardando próxima janela.",
          timestamp: new Date().toISOString()
        });

        return;
      }

      this.historyStats = await historyService.getStats();

      const results = [];

      for (const symbol of selected) {
        try {
          const snapshot = await getMarketSnapshot(symbol);
          this.rateLimiter.register(3);

          const result = await analyzeSymbolForUser(1, symbol, snapshot);

          const enriched = {
            ...result,
            snapshot
          };

          enriched.candleAnalysis = this.analyzeCandlePattern(enriched);
          enriched.finalScore = this.calculateOpportunityScore(enriched);

          const timing = this.getCandleTiming();

          enriched.timing = timing.timing;
          enriched.entryInSeconds = timing.entryInSeconds;
          enriched.timingMode = timing.mode;
          enriched.timingConfidence = timing.confidence;

          const blockCheck = this.shouldBlockTrade(enriched);

          enriched.blocked = blockCheck.blocked;
          enriched.blockReason = blockCheck.reason || null;
          enriched.explanation = this.generateExplanation(enriched);

          results.push(enriched);
        } catch (err) {
          results.push({
            symbol,
            signal: "WAIT",
            confidence: 0,
            finalScore: 0,
            entryQuality: "weak",
            blocked: true,
            blockReason: "Erro ao analisar ativo",
            explanation: "Erro ao analisar ativo",
            error: err.message,
            timestamp: new Date().toISOString()
          });
        }
      }

      this.latestResults = results;

      const best = this.selectBestOpportunity(results);
      this.bestOpportunity = best?.blocked ? null : best;

      if (this.bestOpportunity) {
        this.bestOpportunity.tradingMode =
          runtimeConfig.TRADING_MODE ||
          runtimeConfig.MODE ||
          process.env.TRADING_MODE ||
          "balanced";

        const validation = executionService.validate(this.bestOpportunity);

        this.bestOpportunity.executionValidation = validation;
        this.bestOpportunity.commercialSignal = Boolean(validation.commercialSignal);
        this.bestOpportunity.executionAllowed = Boolean(validation.allowed);
        this.bestOpportunity.executionReason = validation.reason;
        this.bestOpportunity.adjustedScore = validation.adjustedScore;
        this.bestOpportunity.operationMode = validation.mode;

        if (validation.commercialSignal) {
          emitToAll("commercialSignal", {
            ...this.bestOpportunity,
            commercialSignal: true,
            executionAllowed: validation.allowed,
            executionReason: validation.reason,
            adjustedScore: validation.adjustedScore,
            operationMode: validation.mode,
            timestamp: new Date().toISOString()
          });
        }

        if (validation.allowed) {
          const execution = executionService.execute(this.bestOpportunity);
          emitToAll("autoExecution", execution);
        }
      }

      await historyService.addMany(results);
      await resultCheckerService.checkPendingSignals();

      cacheService.set(
        "runtime:state",
        this.getState(),
        (runtimeConfig.ENGINE_INTERVAL_MS || 15000) * 2
      );

      emitToAll("engine:update", {
        bestOpportunity: this.bestOpportunity,
        results: this.latestResults,
        historyStats: this.historyStats,
        rateLimit: this.rateLimiter.getStats(),
        timestamp: new Date().toISOString()
      });
    } finally {
      this.isProcessing = false;
    }
  }

  start() {
    if (this.isRunning) return this.getState();

    this.isRunning = true;

    this.timer = setInterval(() => {
      this.processCycle().catch(() => {});
    }, runtimeConfig.ENGINE_INTERVAL_MS || 15000);

    this.resultTimer = setInterval(() => {
      resultCheckerService.checkPendingSignals().catch(() => {});
    }, 10000);

    this.processCycle().catch(() => {});

    emitToAll("engine:status", {
      status: "running",
      message: "Engine iniciada com IA adaptativa, anti-loss, candle, aprendizado por loss e modo comercial real.",
      timestamp: new Date().toISOString()
    });

    return this.getState();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.resultTimer) clearInterval(this.resultTimer);

    this.timer = null;
    this.resultTimer = null;
    this.isRunning = false;

    emitToAll("engine:status", {
      status: "stopped",
      message: "Engine parada.",
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
      historyStats: this.historyStats,
      rateLimit: this.rateLimiter.getStats()
    };
  }
}

module.exports = new EngineRunnerService();