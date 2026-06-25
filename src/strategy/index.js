const { createBreakoutStrategy } = require("./breakout.strategy");
const { createMomentumStrategy } = require("./momentum.strategy");
const { createPullbackStrategy } = require("./pullback.strategy");
const { createInstitutionalPullbackStrategy } = require("./institutional-pullback.strategy");
const { createLiquiditySweepFalseBreakoutStrategy } = require("./liquidity-sweep-false-breakout.strategy");
const { createReversalStrategy } = require("./reversal.strategy");
const { createTrendContinuationStrategy } = require("./trend-continuation.strategy");

module.exports = {
  createBreakoutStrategy,
  createInstitutionalPullbackStrategy,
  createLiquiditySweepFalseBreakoutStrategy,
  createMomentumStrategy,
  createPullbackStrategy,
  createReversalStrategy,
  createTrendContinuationStrategy
};
