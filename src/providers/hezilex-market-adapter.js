const CryptoMarketProvider = require("./crypto-market-provider");
const { fetchTimeSeries } = require("../services/market-data.service");
const { findHezilexAsset, getHezilexCryptoAssets } = require("../config/hezilex-crypto-assets");

class HezilexMarketAdapter extends CryptoMarketProvider {
  constructor(options = {}) {
    super();
    this.providerName = options.providerName || process.env.CRYPTO_PROVIDER || "twelvedata";
  }

  listSymbols() {
    return getHezilexCryptoAssets().map((asset) => ({ ...asset }));
  }

  normalizeSymbol(symbol) {
    const asset = findHezilexAsset(symbol);
    return asset ? asset.providerSymbol : String(symbol || "").trim();
  }

  resolveDisplayName(providerSymbol) {
    const asset = findHezilexAsset(providerSymbol);
    return asset ? asset.displayName : String(providerSymbol || "").trim();
  }

  getAsset(symbol) {
    return findHezilexAsset(symbol);
  }

  async getCandles(symbol, timeframe = "5min") {
    return fetchTimeSeries(this.normalizeSymbol(symbol), timeframe, Number(process.env.CRYPTO_MIN_CANDLES || 120));
  }

  async getTicker(symbol) {
    const candles = await this.getCandles(symbol, "5min");
    const last = candles[candles.length - 1] || null;
    return { symbol: this.normalizeSymbol(symbol), displayName: this.resolveDisplayName(symbol), price: last?.close ?? null, provider: this.providerName };
  }

  async getVolume(symbol) {
    const candles = await this.getCandles(symbol, "5min");
    return candles.reduce((sum, candle) => sum + Number(candle.volume || 0), 0);
  }

  async getSpread(symbol) {
    const candles = await this.getCandles(symbol, "5min");
    const last = candles[candles.length - 1] || null;
    if (!last?.close) return null;
    return Number((((Number(last.high) - Number(last.low)) / Number(last.close)) * 100).toFixed(6));
  }
}

module.exports = HezilexMarketAdapter;
