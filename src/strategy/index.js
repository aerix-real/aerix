const { createBreakoutStrategy } = require("./breakout.strategy");
const { createMomentumStrategy } = require("./momentum.strategy");
const { createPullbackStrategy } = require("./pullback.strategy");
const { createInstitutionalPullbackStrategy } = require("./institutional-pullback.strategy");
const { createInstitutionalFirstRetestStrategy } = require("./institutional-first-retest.strategy");
const { createLiquiditySweepFalseBreakoutStrategy } = require("./liquidity-sweep-false-breakout.strategy");
const { createReversalStrategy } = require("./reversal.strategy");
const { createTrendContinuationStrategy } = require("./trend-continuation.strategy");
const {
  STRATEGY_REGISTRY,
  createEnabledStrategies,
  getEnabledStrategyDefinitions,
  getStrategyModeWeights,
  getStrategyRegistry
} = require("./strategy-registry");

module.exports = {
  STRATEGY_REGISTRY,
  createBreakoutStrategy,
  createEnabledStrategies,
  createInstitutionalFirstRetestStrategy,
  createInstitutionalPullbackStrategy,
  createLiquiditySweepFalseBreakoutStrategy,
  createMomentumStrategy,
  createPullbackStrategy,
  createReversalStrategy,
  createTrendContinuationStrategy,
  getEnabledStrategyDefinitions,
  getStrategyModeWeights,
  getStrategyRegistry
};
