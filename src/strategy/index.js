const { createBreakoutStrategy } = require("./breakout.strategy");
const { createMomentumStrategy } = require("./momentum.strategy");
const { createPullbackStrategy } = require("./pullback.strategy");
const { createInstitutionalPullbackStrategy } = require("./institutional-pullback.strategy");
const { createReversalStrategy } = require("./reversal.strategy");
const { createTrendContinuationStrategy } = require("./trend-continuation.strategy");

module.exports = {
  createBreakoutStrategy,
  createInstitutionalPullbackStrategy,
  createMomentumStrategy,
  createPullbackStrategy,
  createReversalStrategy,
  createTrendContinuationStrategy
};
