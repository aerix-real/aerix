const HEZILEX_CRYPTO_MARKET_MODE = "HEZILEX_CRYPTO";
const DEFAULT_CRYPTO_TIMEFRAMES = Object.freeze(["5min", "15min", "1h"]);

const PROFILE_BY_DISPLAY_NAME = Object.freeze({
  BITCOIN: "major_crypto",
  ETHEREUM: "major_crypto",
  BNB: "large_mid_cap",
  SOLANA: "large_mid_cap",
  XRP: "large_mid_cap",
  CARDANO: "large_mid_cap",
  LITECOIN: "large_mid_cap",
  AVAX: "large_mid_cap",
  LINK: "large_mid_cap",
  DOGE: "higher_volatility",
  SUI: "higher_volatility"
});

const CRYPTO_PROFILES = Object.freeze({
  major_crypto: Object.freeze({
    label: "Major Crypto",
    volatility: { min: 0.08, max: 3.2 },
    atr: { minPercent: 0.06, maxPercent: 2.4 },
    spread: { max: 0.18 },
    momentum: { min: 0.52 },
    score: { conservative: 86, balanced: 78, aggressive: 70 },
    liquidity: { minVolume: 1000000 },
    candleImpulse: { min: 0.32, max: 1.8 },
    falseBreakout: { confirmationCandles: 2, maxWickRatio: 0.62 },
    pullback: { minRetracement: 0.22, maxRetracement: 0.58 },
    confirmationTime: { candles: 2 }
  }),
  large_mid_cap: Object.freeze({
    label: "Large/Mid Cap",
    volatility: { min: 0.12, max: 4.4 },
    atr: { minPercent: 0.08, maxPercent: 3.1 },
    spread: { max: 0.28 },
    momentum: { min: 0.56 },
    score: { conservative: 90, balanced: 80, aggressive: 71 },
    liquidity: { minVolume: 500000 },
    candleImpulse: { min: 0.38, max: 2.35 },
    falseBreakout: { confirmationCandles: 2, maxWickRatio: 0.66 },
    pullback: { minRetracement: 0.24, maxRetracement: 0.62 },
    confirmationTime: { candles: 3 }
  }),
  higher_volatility: Object.freeze({
    label: "Higher Volatility",
    volatility: { min: 0.18, max: 6.2 },
    atr: { minPercent: 0.12, maxPercent: 4.2 },
    spread: { max: 0.35 },
    momentum: { min: 0.62 },
    score: { conservative: 94, balanced: 84, aggressive: 75 },
    liquidity: { minVolume: 350000 },
    candleImpulse: { min: 0.48, max: 3.1 },
    falseBreakout: { confirmationCandles: 3, maxWickRatio: 0.7 },
    pullback: { minRetracement: 0.28, maxRetracement: 0.68 },
    confirmationTime: { candles: 4 }
  })
});

const RAW_ASSETS = [
  ["BITCOIN", "BTC/USDT", ["BTCUSDT", "BTC/USD"], 1, "tier_1", 180],
  ["LITECOIN", "LTC/USDT", ["LTCUSDT", "LTC/USD"], 7, "tier_2", 140],
  ["CARDANO", "ADA/USDT", ["ADAUSDT", "ADA/USD"], 6, "tier_2", 140],
  ["BNB", "BNB/USDT", ["BNBUSDT", "BNB/USD"], 3, "tier_1", 160],
  ["XRP", "XRP/USDT", ["XRPUSDT", "XRP/USD"], 5, "tier_2", 140],
  ["ETHEREUM", "ETH/USDT", ["ETHUSDT", "ETH/USD"], 2, "tier_1", 180],
  ["SOLANA", "SOL/USDT", ["SOLUSDT", "SOL/USD"], 4, "tier_1", 160],
  ["AVAX", "AVAX/USDT", ["AVAXUSDT", "AVAX/USD"], 8, "tier_2", 140],
  ["DOGE", "DOGE/USDT", ["DOGEUSDT", "DOGE/USD"], 10, "tier_3", 140],
  ["SUI", "SUI/USDT", ["SUIUSDT", "SUI/USD"], 11, "tier_3", 140],
  ["LINK", "LINK/USDT", ["LINKUSDT", "LINK/USD"], 9, "tier_2", 140]
];

const HEZILEX_CRYPTO_ASSETS = Object.freeze(RAW_ASSETS.map(([displayName, providerSymbol, providerAliases, priority, liquidityTier, minimumCandles]) => Object.freeze({
  displayName,
  providerSymbol,
  providerAliases: Object.freeze(providerAliases),
  aliases: Object.freeze(providerAliases),
  enabled: true,
  category: PROFILE_BY_DISPLAY_NAME[displayName],
  liquidityTier,
  priority,
  minimumCandles,
  supportedTimeframes: DEFAULT_CRYPTO_TIMEFRAMES,
  marketMode: HEZILEX_CRYPTO_MARKET_MODE
})));

function getHezilexCryptoAssets() {
  return HEZILEX_CRYPTO_ASSETS.filter((asset) => asset.enabled);
}

function findHezilexAsset(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  return HEZILEX_CRYPTO_ASSETS.find((asset) =>
    asset.displayName === normalized ||
    asset.providerSymbol.toUpperCase() === normalized ||
    asset.providerAliases.some((alias) => alias.toUpperCase() === normalized)
  ) || null;
}

module.exports = {
  CRYPTO_PROFILES,
  DEFAULT_CRYPTO_TIMEFRAMES,
  HEZILEX_CRYPTO_ASSETS,
  HEZILEX_CRYPTO_MARKET_MODE,
  findHezilexAsset,
  getHezilexCryptoAssets
};
