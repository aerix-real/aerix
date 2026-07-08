const { createBreakoutStrategy } = require("./breakout.strategy");
const { createMomentumStrategy } = require("./momentum.strategy");
const { createPullbackStrategy } = require("./pullback.strategy");
const { createInstitutionalPullbackStrategy } = require("./institutional-pullback.strategy");
const { createInstitutionalFirstRetestStrategy } = require("./institutional-first-retest.strategy");
const { createLiquiditySweepFalseBreakoutStrategy } = require("./liquidity-sweep-false-breakout.strategy");
const { createReversalStrategy } = require("./reversal.strategy");
const { createTrendContinuationStrategy } = require("./trend-continuation.strategy");

const ALL_REGIMES = [
  "TRENDING",
  "RANGING",
  "BREAKOUT",
  "REVERSAL",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
  "FALLBACK_DATA",
  "FALLBACK_SIGNAL"
];

const STRATEGY_REGISTRY = Object.freeze([
  Object.freeze({
    strategyName: "trend_continuation",
    displayName: "Trend Continuation",
    enabled: true,
    priority: 10,
    modeWeights: Object.freeze({
      conservative: 1.18,
      balanced: 1.05,
      aggressive: 0.98
    }),
    supportedRegimes: Object.freeze(["TRENDING", "BREAKOUT", "FALLBACK_SIGNAL"]),
    minScore: null,
    factory: createTrendContinuationStrategy,
    handler: createTrendContinuationStrategy,
    description: "Continuação de tendência com confluência MTF e confirmação por indicadores."
  }),
  Object.freeze({
    strategyName: "institutional_pullback",
    displayName: "Institutional Pullback",
    enabled: true,
    priority: 20,
    modeWeights: Object.freeze({
      conservative: 1.08,
      balanced: 1.04,
      aggressive: 1.02
    }),
    supportedRegimes: Object.freeze(["TRENDING", "LOW_VOLATILITY", "FALLBACK_SIGNAL"]),
    minScore: 72,
    factory: createInstitutionalPullbackStrategy,
    handler: createInstitutionalPullbackStrategy,
    description: "Pullback institucional preservado para setups com alinhamento, RSI, ADX e ATR."
  }),
  Object.freeze({
    strategyName: "institutional_first_retest",
    displayName: "Institutional First Retest",
    enabled: true,
    priority: 25,
    modeWeights: Object.freeze({
      conservative: 0.98,
      balanced: 1.02,
      aggressive: 1.04
    }),
    supportedRegimes: Object.freeze(["TRENDING", "BREAKOUT", "FALLBACK_SIGNAL"]),
    minScore: 74,
    factory: createInstitutionalFirstRetestStrategy,
    handler: createInstitutionalFirstRetestStrategy,
    description: "Primeiro retorno institucional após rompimento confirmado, com afastamento mínimo, estrutura preservada e candle de confirmação."
  }),
  Object.freeze({
    strategyName: "pullback",
    displayName: "Pullback",
    enabled: true,
    priority: 30,
    modeWeights: Object.freeze({
      conservative: 1.12,
      balanced: 1.02,
      aggressive: 0.99
    }),
    supportedRegimes: Object.freeze(["TRENDING", "RANGING", "LOW_VOLATILITY"]),
    minScore: 70,
    factory: createPullbackStrategy,
    handler: createPullbackStrategy,
    description: "Pullback clássico existente, mantido sem alteração de lógica."
  }),
  Object.freeze({
    strategyName: "breakout",
    displayName: "Breakout",
    enabled: true,
    priority: 40,
    modeWeights: Object.freeze({
      conservative: 0.92,
      balanced: 1.03,
      aggressive: 1.12
    }),
    supportedRegimes: Object.freeze(["BREAKOUT", "HIGH_VOLATILITY", "TRENDING"]),
    minScore: 72,
    factory: createBreakoutStrategy,
    handler: createBreakoutStrategy,
    description: "Rompimento com validações existentes de momentum e contexto de preço."
  }),
  Object.freeze({
    strategyName: "momentum",
    displayName: "Momentum",
    enabled: true,
    priority: 50,
    modeWeights: Object.freeze({
      conservative: 0.88,
      balanced: 1.03,
      aggressive: 1.14
    }),
    supportedRegimes: Object.freeze(["BREAKOUT", "HIGH_VOLATILITY", "TRENDING"]),
    minScore: 72,
    factory: createMomentumStrategy,
    handler: createMomentumStrategy,
    description: "Momentum direcional existente, mantido com o mesmo handler."
  }),
  Object.freeze({
    strategyName: "reversal",
    displayName: "Reversal",
    enabled: true,
    priority: 60,
    modeWeights: Object.freeze({
      conservative: 0.72,
      balanced: 0.94,
      aggressive: 1.06
    }),
    supportedRegimes: Object.freeze(["REVERSAL", "RANGING", "HIGH_VOLATILITY"]),
    minScore: 70,
    factory: createReversalStrategy,
    handler: createReversalStrategy,
    description: "Reversão existente com prioridade posterior às estratégias pró-tendência."
  }),
  Object.freeze({
    strategyName: "liquidity_sweep_false_breakout",
    displayName: "Liquidity Sweep False Breakout",
    enabled: true,
    priority: 70,
    modeWeights: Object.freeze({
      conservative: 0.82,
      balanced: 0.9,
      aggressive: 0.96
    }),
    supportedRegimes: Object.freeze(ALL_REGIMES),
    minScore: 72,
    factory: createLiquiditySweepFalseBreakoutStrategy,
    handler: createLiquiditySweepFalseBreakoutStrategy,
    description: "False breakout de primeira classe com varredura de liquidez, retorno à faixa e peso inicial moderado/baixo."
  })
]);

function getStrategyRegistry() {
  return STRATEGY_REGISTRY;
}

function getEnabledStrategyDefinitions() {
  return STRATEGY_REGISTRY
    .filter((strategy) => strategy.enabled)
    .sort((left, right) => left.priority - right.priority);
}

function getStrategyModeWeights(mode = "balanced") {
  return STRATEGY_REGISTRY.reduce((weights, strategy) => ({
    ...weights,
    [strategy.strategyName]: Number(strategy.modeWeights?.[mode] ?? 1)
  }), {});
}

function createEnabledStrategies() {
  return getEnabledStrategyDefinitions().map((strategy) => strategy.factory());
}

module.exports = {
  STRATEGY_REGISTRY,
  createEnabledStrategies,
  getEnabledStrategyDefinitions,
  getStrategyModeWeights,
  getStrategyRegistry
};
