class CryptoMarketProvider {
  listSymbols() { throw new Error("CryptoMarketProvider.listSymbols must be implemented"); }
  getCandles() { throw new Error("CryptoMarketProvider.getCandles must be implemented"); }
  getTicker() { throw new Error("CryptoMarketProvider.getTicker must be implemented"); }
  getVolume() { throw new Error("CryptoMarketProvider.getVolume must be implemented"); }
  getSpread() { throw new Error("CryptoMarketProvider.getSpread must be implemented"); }
  normalizeSymbol() { throw new Error("CryptoMarketProvider.normalizeSymbol must be implemented"); }
  resolveDisplayName() { throw new Error("CryptoMarketProvider.resolveDisplayName must be implemented"); }
}

module.exports = CryptoMarketProvider;
