class ExecutionService {
  constructor() {
    this.lastExecution = null;
    this.lossMemory = new Map();
  }

  getKey(signal) {
    const symbol = signal.symbol || signal.asset || "unknown";
    const direction = signal.signal || signal.direction || "WAIT";
    const strategy = signal.strategyName || signal.strategy || "unknown";
    const hour = new Date().getHours();

    return `${symbol}:${direction}:${strategy}:${hour}`;
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

  getLossLearningPenalty(signal) {
    if (!signal) return 0;

    const key = this.getKey(signal);
    const memory = this.lossMemory.get(key);

    let penalty = 0;

    if (memory?.total >= 3 && memory.losses / memory.total >= 0.65) {
      penalty -= 8;
    }

    if (memory?.total >= 5 && memory.losses / memory.total >= 0.75) {
      penalty -= 14;
    }

    if (memory?.total >= 7 && memory.losses / memory.total >= 0.85) {
      penalty -= 22;
    }

    const externalLossPattern = signal.lossPattern || signal.lossLearning || null;

    if (externalLossPattern?.total >= 4 && externalLossPattern.lossrate >= 70) {
      penalty -= 12;
    }

    if (externalLossPattern?.total >= 6 && externalLossPattern.lossrate >= 80) {
      penalty -= 20;
    }

    return penalty;
  }

  learnFromResult(signal, result) {
    if (!signal || !result) return;

    const normalized = String(result).toLowerCase();

    if (!["win", "loss", "green", "red", "won", "lost"].includes(normalized)) {
      return;
    }

    const key = this.getKey(signal);
    const current = this.lossMemory.get(key) || {
      total: 0,
      wins: 0,
      losses: 0,
      lastResult: null,
      updatedAt: null
    };

    current.total += 1;

    if (["win", "green", "won"].includes(normalized)) {
      current.wins += 1;
    }

    if (["loss", "red", "lost"].includes(normalized)) {
      current.losses += 1;
    }

    current.lastResult = normalized;
    current.updatedAt = new Date().toISOString();

    this.lossMemory.set(key, current);
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
    const lossPenalty = this.getLossLearningPenalty(signal);
    const adjustedScore = baseScore + lossPenalty;

    if (!symbol) {
      return { allowed: false, reason: "Ativo inválido", adjustedScore, mode, commercialSignal: false };
    }

    if (["WAIT", "AGUARDAR", "AGUARDANDO"].includes(direction)) {
      return { allowed: false, reason: "Sem direção definida", adjustedScore, mode, commercialSignal: false };
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
        commercialSignal: true
      };
    }

    if (signal.blocked) {
      return {
        allowed: false,
        reason: signal.blockReason || "Bloqueado pela IA",
        adjustedScore,
        mode,
        commercialSignal: adjustedScore >= minimumScore
      };
    }

    if (lossPenalty <= -20) {
      return {
        allowed: false,
        reason: "IA bloqueou por padrão forte de loss",
        adjustedScore,
        mode,
        commercialSignal: false
      };
    }

    if (adjustedScore < minimumScore) {
      return {
        allowed: false,
        reason: `Score insuficiente para modo ${mode} (${adjustedScore}/${minimumScore})`,
        adjustedScore,
        mode,
        commercialSignal: false
      };
    }

    const validTimingWindow = ["ENTRAR AGORA", "PREPARAR ENTRADA"].includes(signal.timing);

    if (!validTimingWindow) {
      return {
        allowed: false,
        reason: "Fora da janela operacional",
        adjustedScore,
        mode,
        commercialSignal: true
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
        commercialSignal: true
      };
    }

    const mtf = signal.mtf || {};
    const aligned =
      (mtf.h1?.aligned ? 1 : 0) +
      (mtf.m15?.aligned ? 1 : 0) +
      (mtf.m5?.aligned ? 1 : 0);

    const minimumMtf = mode === "conservative" ? 2 : 1;

    if (aligned < minimumMtf) {
      return {
        allowed: false,
        reason: `Falta de alinhamento MTF (${aligned}/${minimumMtf})`,
        adjustedScore,
        mode,
        commercialSignal: true
      };
    }

    return {
      allowed: true,
      reason:
        lossPenalty < 0
          ? `Entrada aprovada no modo ${mode}, com penalidade por histórico de loss (${lossPenalty})`
          : `Entrada aprovada pela IA no modo ${mode}`,
      adjustedScore,
      mode,
      commercialSignal: true
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
        reason: validation.reason,
        adjustedScore: validation.adjustedScore,
        mode: validation.mode,
        commercialSignal: validation.commercialSignal
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
      time: Date.now()
    };

    console.log(
      "🚀 EXECUTANDO:",
      symbol,
      direction,
      `Modo: ${validation.mode}`,
      `Score: ${score}`,
      `Score IA: ${validation.adjustedScore}`
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
      time: new Date().toISOString()
    };
  }
}

module.exports = new ExecutionService();