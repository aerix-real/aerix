const assert = require("assert");
const { buildPreSignalOpportunity, getNextCandleOpen } = require("../src/strategy/strategy-runner.service");

function snapshot(overrides = {}) {
  const candle = { time: "2026-07-12T14:20:00.000Z", close: 100, closed: true };
  return {
    symbol: "EUR/USD",
    displayName: "EUR/USD",
    marketMode: "FOREX",
    timestamp: "2026-07-12T14:23:42.000Z",
    dataQuality: { isFallback: false },
    timeframes: {
      m5: { candles: Array(60).fill(candle), volatilityPercent: 0.2, direction: "up" },
      m15: { candles: Array(60).fill(candle), direction: "up" },
      h1: { candles: Array(60).fill(candle), direction: "up" }
    },
    ...overrides
  };
}

function strategy(name, direction, score, failed = ["aguardando candle de recuperação"], extra = {}) {
  return {
    name,
    valid: false,
    direction,
    score,
    rawScore: score,
    weightedScore: score,
    explanation: `${name} próximo da confirmação`,
    eligibilityAudit: {
      direction,
      score,
      criteriaPassed: 3,
      criteria: [
        { label: "tendência alinhada", passed: true },
        ...failed.map((label) => ({ label, passed: false }))
      ],
      blockedBy: failed[0]
    },
    ...extra
  };
}

const mtf2 = { alignment: 2, dominantDirection: "up", isAligned: false };
const mtf3 = { alignment: 3, dominantDirection: "up", isAligned: true };
const okValidation = { shouldBlock: false, hasInsufficientCandles: false };

function build({ name = "institutional_pullback", direction = "CALL", score = 72, failed, mode = "balanced", mtf = mtf2, snap, validation = okValidation, marketRegime = "TRENDING", bestConfirmed = null, extra } = {}) {
  return buildPreSignalOpportunity({
    snapshot: snap || snapshot(),
    mode,
    evaluated: [strategy(name, direction, score, failed, extra)],
    mtf,
    marketRegime,
    marketValidation: validation,
    bestConfirmed
  });
}

// 1. Pullback próximo da confirmação.
{
  const opportunity = build({ name: "institutional_pullback", failed: ["aguardando candle de recuperação"] });
  assert.equal(opportunity.signalState, "POSSIBILITY");
  assert.equal(opportunity.executionAllowed, false);
  assert.equal(opportunity.preSignal, true);
  assert.equal(opportunity.direction, "CALL");
  assert.equal(opportunity.suggestedEntryAt, "2026-07-12T14:25:00.000Z");
  assert.equal(opportunity.pendingConfirmations.length, 1);
}

// 2-7. Estratégias elegíveis aguardando confirmação final.
[
  ["liquidity_sweep_false_breakout", "PUT", "aguardando retorno para dentro da faixa", "REVERSAL"],
  ["institutional_first_retest", "CALL", "aguardando rejeição no nível", "TRENDING"],
  ["trend_continuation", "CALL", "aguardando confirmação M5", "TRENDING"],
  ["breakout", "CALL", "aguardando fechamento acima da resistência", "BREAKOUT"],
  ["momentum", "CALL", "aguardando confirmação de momentum", "TRENDING"],
  ["reversal", "PUT", "aguardando candle confirmador", "REVERSAL"]
].forEach(([name, direction, pending, regime]) => {
  const opportunity = build({ name, direction, failed: [pending], marketRegime: regime });
  assert.equal(opportunity.signalState, "POSSIBILITY", name);
  assert.equal(opportunity.direction, direction, name);
  assert.deepEqual(opportunity.pendingConfirmations, [pending], name);
});

// 8. Estratégias com direções conflitantes.
{
  const conflict = buildPreSignalOpportunity({
    snapshot: snapshot(),
    mode: "aggressive",
    evaluated: [strategy("momentum", "CALL", 70), strategy("liquidity_sweep_false_breakout", "PUT", 70)],
    mtf: mtf2,
    marketRegime: "REVERSAL",
    marketValidation: okValidation
  });
  assert.equal(conflict.signalState, "WAIT");
  assert.equal(conflict.directionConflict, true);
}

// 9. Hard block ativo.
assert.equal(build({ validation: { shouldBlock: true, hasInsufficientCandles: false } }).signalState, "WAIT");

// 10. Dados insuficientes.
assert.equal(build({ validation: { shouldBlock: true, hasInsufficientCandles: true } }).signalState, "WAIT");

// 11. Candle aberto.
{
  const openCandle = snapshot({ timeframes: { ...snapshot().timeframes, m5: { ...snapshot().timeframes.m5, candles: Array(60).fill({ closed: false, close: 100 }) } } });
  assert.equal(build({ snap: openCandle, mode: "aggressive", score: 80 }).signalState, "WAIT");
}

// 12. Possibilidade confirmada vira estado confirmado e não pré-sinal.
{
  const confirmed = build({ bestConfirmed: { direction: "CALL", name: "institutional_pullback", score: 95 } });
  assert.equal(confirmed.signalState, "CONFIRMED");
  assert.equal(confirmed.preSignal, false);
}

// 13. Possibilidade cancelada ao invalidar contexto.
build({ snap: snapshot({ symbol: "CANCEL/TEST" }) });
assert.equal(build({ snap: snapshot({ symbol: "CANCEL/TEST" }), validation: { shouldBlock: true, hasInsufficientCandles: false } }).signalState, "WAIT");

// 14. Possibilidade expirada não mantém sugestão vencida.
build({ snap: snapshot({ symbol: "EXPIRE/TEST", timestamp: "2026-07-12T14:23:42.000Z" }) });
const expired = build({ snap: snapshot({ symbol: "EXPIRE/TEST", timestamp: "2026-07-12T14:26:30.000Z" }) });
assert.equal(expired.suggestedEntryAt, "2026-07-12T14:30:00.000Z");

// 15. Mesmo pré-sinal recebido novamente mantém createdAt.
const first = build({ snap: snapshot({ symbol: "SAME/TEST" }) });
const again = build({ snap: snapshot({ symbol: "SAME/TEST" }) });
assert.equal(again.preSignalKey, first.preSignalKey);
assert.equal(again.preSignalCreatedAt, first.preSignalCreatedAt);

// 16. Novo pré-sinal substitui o anterior.
const replaced = build({ snap: snapshot({ symbol: "SAME/TEST" }), direction: "CALL", name: "breakout" });
assert.notEqual(replaced.preSignalKey, first.preSignalKey);

// 17-19. Limites por modo.
assert.equal(build({ mode: "conservative", score: 75, mtf: mtf2, failed: ["aguardando candle de recuperação"] }).signalState, "POSSIBILITY");
assert.equal(build({ mode: "balanced", score: 68, mtf: mtf2, failed: ["aguardando candle", "aguardando momentum"] }).signalState, "POSSIBILITY");
assert.equal(build({ mode: "aggressive", score: 60, mtf: { alignment: 0 }, failed: ["aguardando confirmação final"] }).signalState, "POSSIBILITY");

// 20. Forex.
assert.equal(build({ snap: snapshot({ symbol: "GBP/USD", marketMode: "FOREX" }) }).signalState, "POSSIBILITY");

// 21. Hezilex Crypto.
assert.equal(build({ snap: snapshot({ symbol: "BTC/USD", displayName: "BITCOIN", marketMode: "HEZILEX_CRYPTO" }), mtf: mtf3 }).signalState, "POSSIBILITY");

// Regras críticas.
assert.equal(build({ direction: null, score: 90, mode: "aggressive" }).signalState, "WAIT");
assert.equal(getNextCandleOpen(new Date("2026-07-12T14:23:42.000Z"), 5).toISOString(), "2026-07-12T14:25:00.000Z");
console.log("pre-signal opportunity tests passed");
