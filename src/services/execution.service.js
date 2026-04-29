let aiMemoryRepository = null;

try {
  aiMemoryRepository = require("../repositories/aiMemory.repository");
} catch (error) {
  console.warn("⚠️ aiMemory.repository não encontrado. IA persistente rodará apenas em memória.");
}

class ExecutionService {
  constructor() {
    this.lastExecution = null;
    this.lossMemory = new Map();
    this.globalAssetMemory = new Map();
    this.recentExecutions = [];
    this.loadedPersistentKeys = new Set();
    this.badHourBlocks = new Map();
  }

  getKey(signal) {
    const symbol = signal.symbol || signal.asset || "unknown";
    const direction = signal.signal || signal.direction || "WAIT";
    const strategy = signal.strategyName || signal.strategy || "unknown";
    const hour = new Date().getHours();

    return `${symbol}:${direction}:${strategy}:${hour}`;
  }

  getHourKey(signal) {
    const symbol = signal.symbol || signal.asset || "unknown";
    const hour = new Date().getHours();

    return `${symbol}:${hour}`;
  }

  getAssetKey(signal) {
    return signal.symbol || signal.asset || "unknown";
  }

  getScore(signal) {
    return Number(signal.finalScore ?? signal.confidence ?? signal.score ?? 0);
  }

  getDirection(signal) {
    return signal.signal || signal.direction || "WAIT";
  }

  getSymbol(signal) {
    return signal.symbol || signal.asset || null;
  }

  getMode(signal) {
    const rawMode =
      signal.tradingMode ||
      signal.operationMode ||
      process.env.TRADING_MODE ||
      "balanced";

    const mode = String(rawMode).toLowerCase();

    if (["conservador", "conservative"].includes(mode)) return "conservative";
    if (["agressivo", "aggressive"].includes(mode)) return "aggressive";

    return "balanced";
  }

  getMinimumScoreByMode(signal) {
    const mode = this.getMode(signal);

    if (mode === "conservative") return 88;
    if (mode === "aggressive") return 70;

    return 78;
  }

  normalizeResultList(list) {
    if (!Array.isArray(list)) return [];

    return list
      .map(item => String(item).toLowerCase())
      .filter(item => ["win", "loss"].includes(item));
  }

  calculateWinRate(memory) {
    if (!memory || !memory.total) return 0;

    return memory.wins / memory.total;
  }

  calculateLossRate(memory) {
    if (!memory || !memory.total) return 0;

    return memory.losses / memory.total;
  }

  async loadPersistentMemory(signal) {
    if (!signal || !aiMemoryRepository) return null;

    const key = this.getKey(signal);

    if (this.loadedPersistentKeys.has(key)) {
      return this.lossMemory.get(key) || null;
    }

    try {
      const saved = await aiMemoryRepository.getMemory(key);

      this.loadedPersistentKeys.add(key);

      if (!saved) return null;

      const memory = {
        total: Number(saved.total || 0),
        wins: Number(saved.wins || 0),
        losses: Number(saved.losses || 0),
        lastResults: this.normalizeResultList(saved.last_results)
      };

      this.lossMemory.set(key, memory);

      return memory;
    } catch (error) {
      console.error("Erro ao carregar memória persistente da IA:", error.message);
      return null;
    }
  }

  preloadPersistentMemory(signal) {
    if (!signal || !aiMemoryRepository) return;

    const key = this.getKey(signal);

    if (this.loadedPersistentKeys.has(key)) return;

    this.loadPersistentMemory(signal).catch(error => {
      console.error("Erro no preload da memória da IA:", error.message);
    });
  }

  getAdaptiveScoreAdjustment(signal) {
    if (!signal) return 0;

    this.preloadPersistentMemory(signal);

    const key = this.getKey(signal);
    const assetKey = this.getAssetKey(signal);

    const memory = this.lossMemory.get(key);
    const assetMemory = this.globalAssetMemory.get(assetKey);

    let adjustment = 0;

    const contextWinRate = this.calculateWinRate(memory);
    const contextLossRate = this.calculateLossRate(memory);
    const assetWinRate = this.calculateWinRate(assetMemory);
    const assetLossRate = this.calculateLossRate(assetMemory);

    if (memory?.total >= 3) {
      if (contextWinRate >= 0.7) adjustment += 5;
      if (contextWinRate >= 0.8) adjustment += 9;
      if (contextWinRate >= 0.9) adjustment += 14;

      if (contextLossRate >= 0.65) adjustment -= 6;
      if (contextLossRate >= 0.75) adjustment -= 12;
      if (contextLossRate >= 0.85) adjustment -= 20;
    }

    if (assetMemory?.total >= 5) {
      if (assetWinRate >= 0.68) adjustment += 4;
      if (assetWinRate >= 0.78) adjustment += 7;

      if (assetLossRate >= 0.68) adjustment -= 5;
      if (assetLossRate >= 0.78) adjustment -= 10;
    }

    const recent = memory?.lastResults || [];

    if (recent.length >= 3) {
      const last3 = recent.slice(-3);
      const last5 = recent.slice(-5);

      if (last3.every(r => r === "win")) adjustment += 6;
      if (last3.every(r => r === "loss")) adjustment -= 10;

      if (last5.length >= 5) {
        const recentWins = last5.filter(r => r === "win").length;
        const recentLosses = last5.filter(r => r === "loss").length;

        if (recentWins >= 4) adjustment += 5;
        if (recentLosses >= 4) adjustment -= 8;
      }
    }

    if (signal.strategyScoreAdjustment) {
      adjustment += Number(signal.strategyScoreAdjustment || 0);
    }

    if (signal.assetScoreAdjustment) {
      adjustment += Number(signal.assetScoreAdjustment || 0);
    }

    if (adjustment > 18) adjustment = 18;
    if (adjustment < -25) adjustment = -25;

    return adjustment;
  }

  getLossLearningPenalty(signal) {
    if (!signal) return 0;

    this.preloadPersistentMemory(signal);

    const key = this.getKey(signal);
    const assetKey = this.getAssetKey(signal);

    const memory = this.lossMemory.get(key);
    const assetMemory = this.globalAssetMemory.get(assetKey);

    let penalty = 0;

    if (memory?.total >= 3 && memory.losses / memory.total >= 0.65) penalty -= 8;
    if (memory?.total >= 5 && memory.losses / memory.total >= 0.75) penalty -= 14;
    if (memory?.total >= 7 && memory.losses / memory.total >= 0.85) penalty -= 22;

    if (assetMemory?.total >= 5 && assetMemory.losses / assetMemory.total >= 0.7) {
      penalty -= 10;
    }

    if (
      memory?.lastResults?.length >= 3 &&
      memory.lastResults.slice(-3).every(r => r === "loss")
    ) {
      penalty -= 12;
    }

    const external = signal.lossPattern || signal.lossLearning;

    if (external?.total >= 4 && external.lossrate >= 70) penalty -= 12;
    if (external?.total >= 6 && external.lossrate >= 80) penalty -= 20;

    return penalty;
  }

  getBadHourPenalty(signal) {
    if (!signal) return 0;

    const key = this.getKey(signal);
    const memory = this.lossMemory.get(key);

    if (!memory || memory.total < 3) return 0;

    const lossRate = memory.losses / memory.total;

    if (memory.total >= 7 && lossRate >= 0.85) return -28;
    if (memory.total >= 5 && lossRate >= 0.78) return -18;
    if (memory.total >= 3 && lossRate >= 0.7) return -10;

    return 0;
  }

  isBadHourBlocked(signal) {
    if (!signal) {
      return {
        blocked: false,
        reason: null,
        lossRate: 0,
        total: 0
      };
    }

    const key = this.getKey(signal);
    const hourKey = this.getHourKey(signal);
    const memory = this.lossMemory.get(key);

    const previousBlock = this.badHourBlocks.get(hourKey);
    const now = Date.now();

    if (previousBlock && now < previousBlock.expiresAt) {
      return {
        blocked: true,
        reason: previousBlock.reason,
        lossRate: previousBlock.lossRate,
        total: previousBlock.total
      };
    }

    if (!memory || memory.total < 4) {
      return {
        blocked: false,
        reason: null,
        lossRate: 0,
        total: memory?.total || 0
      };
    }

    const lossRate = memory.losses / memory.total;

    const shouldBlock =
      (memory.total >= 4 && lossRate >= 0.75) ||
      (
        memory.total >= 6 &&
        lossRate >= 0.7 &&
        memory.lastResults?.slice(-3).every(r => r === "loss")
      ) ||
      (memory.total >= 8 && lossRate >= 0.65);

    if (!shouldBlock) {
      return {
        blocked: false,
        reason: null,
        lossRate,
        total: memory.total
      };
    }

    const blockMinutes =
      lossRate >= 0.85 ? 90 :
      lossRate >= 0.75 ? 60 :
      30;

    const reason = `IA bloqueou este horário para ${this.getSymbol(signal)}: histórico ruim (${memory.losses}/${memory.total} losses)`;

    this.badHourBlocks.set(hourKey, {
      reason,
      lossRate,
      total: memory.total,
      expiresAt: now + blockMinutes * 60 * 1000
    });

    return {
      blocked: true,
      reason,
      lossRate,
      total: memory.total
    };
  }

  async learnFromResult(signal, result) {
    if (!signal || !result) return;

    const normalized = String(result).toLowerCase();

    if (!["win", "loss", "green", "red", "won", "lost"].includes(normalized)) {
      return;
    }

    await this.loadPersistentMemory(signal);

    const key = this.getKey(signal);
    const assetKey = this.getAssetKey(signal);

    const isWin = ["win", "green", "won"].includes(normalized);
    const isLoss = ["loss", "red", "lost"].includes(normalized);

    const current = this.lossMemory.get(key) || {
      total: 0,
      wins: 0,
      losses: 0,
      lastResults: []
    };

    current.total += 1;
    if (isWin) current.wins += 1;
    if (isLoss) current.losses += 1;

    current.lastResults.push(isWin ? "win" : "loss");
    if (current.lastResults.length > 10) current.lastResults.shift();

    this.lossMemory.set(key, current);

    const assetMem = this.globalAssetMemory.get(assetKey) || {
      total: 0,
      wins: 0,
      losses: 0
    };

    assetMem.total += 1;
    if (isWin) assetMem.wins += 1;
    if (isLoss) assetMem.losses += 1;

    this.globalAssetMemory.set(assetKey, assetMem);

    if (aiMemoryRepository) {
      try {
        const symbol = this.getSymbol(signal);
        const direction = this.getDirection(signal);
        const strategy = signal.strategyName || signal.strategy || "unknown";
        const hour = new Date().getHours();

        await aiMemoryRepository.upsertMemory({
          memoryKey: key,
          symbol,
          direction,
          strategy,
          hour,
          total: current.total,
          wins: current.wins,
          losses: current.losses,
          lastResults: current.lastResults
        });
      } catch (error) {
        console.error("Erro ao persistir memória da IA:", error.message);
      }
    }
  }

  isOvertrading() {
    const now = Date.now();

    this.recentExecutions = this.recentExecutions.filter(
      exec => now - exec < 5 * 60 * 1000
    );

    return this.recentExecutions.length >= 3;
  }

  validate(signal) {
    if (!signal) {
      return {
        allowed: false,
        reason: "Sem sinal disponível",
        adjustedScore: 0,
        commercialSignal: false
      };
    }

    const symbol = this.getSymbol(signal);
    const direction = this.getDirection(signal);
    const mode = this.getMode(signal);
    const minimumScore = this.getMinimumScoreByMode(signal);

    const baseScore = this.getScore(signal);
    const adaptiveScoreAdjustment = this.getAdaptiveScoreAdjustment(signal);
    const lossPenalty = this.getLossLearningPenalty(signal);
    const badHourPenalty = this.getBadHourPenalty(signal);

    const adjustedScore =
      baseScore +
      adaptiveScoreAdjustment +
      lossPenalty +
      badHourPenalty;

    if (!symbol) {
      return {
        allowed: false,
        reason: "Ativo inválido",
        adjustedScore,
        mode,
        commercialSignal: false
      };
    }

    if (["WAIT", "AGUARDAR", "AGUARDANDO"].includes(direction)) {
      return {
        allowed: false,
        reason: "Sem direção definida",
        adjustedScore,
        mode,
        commercialSignal: false
      };
    }

    const badHour = this.isBadHourBlocked(signal);

    if (badHour.blocked) {
      return {
        allowed: false,
        reason: badHour.reason,
        adjustedScore,
        mode,
        commercialSignal: false,
        aiBlock: {
          type: "BAD_HOUR",
          lossRate: Number((badHour.lossRate * 100).toFixed(2)),
          total: badHour.total
        },
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    if (this.isOvertrading()) {
      return {
        allowed: false,
        reason: "Bloqueado por overtrading",
        adjustedScore,
        mode,
        commercialSignal: false,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    if (
      this.lastExecution &&
      this.lastExecution.symbol === symbol &&
      Date.now() - this.lastExecution.time < 60000
    ) {
      return {
        allowed: false,
        reason: "Entrada recente no mesmo ativo",
        adjustedScore,
        mode,
        commercialSignal: true,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    if (signal.blocked) {
      return {
        allowed: false,
        reason: signal.blockReason || "Bloqueado pela IA",
        adjustedScore,
        mode,
        commercialSignal: adjustedScore >= minimumScore,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    if (lossPenalty <= -20 || adaptiveScoreAdjustment <= -20) {
      return {
        allowed: false,
        reason: "IA bloqueou por baixa performance histórica",
        adjustedScore,
        mode,
        commercialSignal: false,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    if (adjustedScore < minimumScore) {
      return {
        allowed: false,
        reason: `Score ajustado insuficiente (${adjustedScore}/${minimumScore})`,
        adjustedScore,
        mode,
        commercialSignal: false,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    const validTiming = ["ENTRAR AGORA", "PREPARAR ENTRADA"];

    if (!validTiming.includes(signal.timing)) {
      return {
        allowed: false,
        reason: "Fora da janela de entrada",
        adjustedScore,
        mode,
        commercialSignal: true,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    if (
      signal.candleAnalysis &&
      signal.candleAnalysis.candleBias !== "neutral" &&
      signal.candleAnalysis.candleBias !== direction
    ) {
      return {
        allowed: false,
        reason: "Candle contra o sinal",
        adjustedScore,
        mode,
        commercialSignal: true,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    const mtf = signal.mtf || {};
    const aligned =
      (mtf.h1?.aligned ? 1 : 0) +
      (mtf.m15?.aligned ? 1 : 0) +
      (mtf.m5?.aligned ? 1 : 0);

    const minMtf = mode === "conservative" ? 2 : 1;

    if (aligned < minMtf) {
      return {
        allowed: false,
        reason: `Falta de alinhamento MTF (${aligned}/${minMtf})`,
        adjustedScore,
        mode,
        commercialSignal: true,
        aiAdjustments: {
          adaptiveScoreAdjustment,
          lossPenalty,
          badHourPenalty
        }
      };
    }

    return {
      allowed: true,
      reason:
        adaptiveScoreAdjustment > 0
          ? `Entrada aprovada com reforço da IA (+${adaptiveScoreAdjustment})`
          : adaptiveScoreAdjustment < 0
            ? `Entrada aprovada com redução preventiva da IA (${adaptiveScoreAdjustment})`
            : lossPenalty < 0
              ? `Entrada aprovada com ajuste IA (${lossPenalty})`
              : "Entrada aprovada pela IA",
      adjustedScore,
      mode,
      commercialSignal: true,
      aiAdjustments: {
        adaptiveScoreAdjustment,
        lossPenalty,
        badHourPenalty
      }
    };
  }

  shouldExecute(signal) {
    return this.validate(signal).allowed;
  }

  execute(signal) {
    const validation = this.validate(signal);

    if (!validation.allowed) {
      console.log("⛔ BLOQUEADO:", validation.reason);

      return {
        executed: false,
        ...validation
      };
    }

    const symbol = this.getSymbol(signal);
    const direction = this.getDirection(signal);
    const score = this.getScore(signal);

    this.lastExecution = {
      symbol,
      direction,
      score,
      adjustedScore: validation.adjustedScore,
      mode: validation.mode,
      aiAdjustments: validation.aiAdjustments || null,
      time: Date.now()
    };

    this.recentExecutions.push(Date.now());

    console.log(
      "🚀 EXECUTANDO:",
      symbol,
      direction,
      `Modo: ${validation.mode}`,
      `Score base: ${score}`,
      `Score IA: ${validation.adjustedScore}`,
      `Ajuste adaptativo: ${validation.aiAdjustments?.adaptiveScoreAdjustment || 0}`
    );

    return {
      executed: true,
      symbol,
      direction,
      score,
      adjustedScore: validation.adjustedScore,
      mode: validation.mode,
      timing: signal.timing,
      entryInSeconds: Number(signal.entryInSeconds ?? 0),
      reason: validation.reason,
      commercialSignal: true,
      aiAdjustments: validation.aiAdjustments || null,
      time: new Date().toISOString()
    };
  }
}

module.exports = new ExecutionService();