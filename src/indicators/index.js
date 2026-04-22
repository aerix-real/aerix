const { calculateADX, getLastADX, getADXState } = require("./adx.indicator");
const { calculateATR, getLastATR, classifyATR } = require("./atr.indicator");
const {
  calculateBollingerBands,
  calculateBollingerBandsFromCandles,
  getLastBollinger,
  getBollingerState
} = require("./bollinger.indicator");
const {
  calculateEMA,
  calculateEMAFromCandles,
  getLastEMA,
  getLastEMAFromCandles
} = require("./ema.indicator");
const {
  calculateMACD,
  calculateMACDFromCandles,
  getLastMACD,
  getMACDState
} = require("./macd.indicator");
const {
  calculateRSI,
  calculateRSIFromCandles,
  getLastRSI,
  getLastRSIFromCandles,
  getRSIZone
} = require("./rsi.indicator");
const {
  calculateSMA,
  calculateSMAFromCandles,
  getLastSMA,
  getLastSMAFromCandles
} = require("./sma.indicator");
const {
  calculateStochastic,
  getLastStochastic,
  getStochasticState
} = require("./stochastic.indicator");
const {
  findSupportResistanceLevels,
  getNearestSupportResistance,
  getPriceZone
} = require("./support-resistance.indicator");

module.exports = {
  calculateADX,
  getLastADX,
  getADXState,
  calculateATR,
  getLastATR,
  classifyATR,
  calculateBollingerBands,
  calculateBollingerBandsFromCandles,
  getLastBollinger,
  getBollingerState,
  calculateEMA,
  calculateEMAFromCandles,
  getLastEMA,
  getLastEMAFromCandles,
  calculateMACD,
  calculateMACDFromCandles,
  getLastMACD,
  getMACDState,
  calculateRSI,
  calculateRSIFromCandles,
  getLastRSI,
  getLastRSIFromCandles,
  getRSIZone,
  calculateSMA,
  calculateSMAFromCandles,
  getLastSMA,
  getLastSMAFromCandles,
  calculateStochastic,
  getLastStochastic,
  getStochasticState,
  findSupportResistanceLevels,
  getNearestSupportResistance,
  getPriceZone
};