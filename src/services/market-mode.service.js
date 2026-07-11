const HezilexMarketAdapter = require("../providers/hezilex-market-adapter");
const {
  CRYPTO_PROFILES,
  HEZILEX_CRYPTO_MARKET_MODE,
  findHezilexAsset,
  getHezilexCryptoAssets
} = require("../config/hezilex-crypto-assets");

const FOREX_MARKET_MODE = "FOREX";
let rotationCursor = 0;

function getMarketMode() {
  const mode = String(process.env.MARKET_MODE || FOREX_MARKET_MODE).trim().toUpperCase();
  return mode === HEZILEX_CRYPTO_MARKET_MODE ? HEZILEX_CRYPTO_MARKET_MODE : FOREX_MARKET_MODE;
}

function isHezilexCryptoMode() {
  return getMarketMode() === HEZILEX_CRYPTO_MARKET_MODE;
}

function logCryptoAudit(event, payload = {}) {
  console.log(JSON.stringify({
    scope: "aerix_hezilex_crypto_audit",
    event,
    timestamp: new Date().toISOString(),
    marketMode: HEZILEX_CRYPTO_MARKET_MODE,
    ...payload
  }));
}

function uniqueAssets(assets) {
  const seenDisplays = new Set();
  const seenProviders = new Set();
  return assets.filter((asset) => {
    const display = asset.displayName.toUpperCase();
    const provider = asset.providerSymbol.toUpperCase();
    if (seenDisplays.has(display) || seenProviders.has(provider)) return false;
    seenDisplays.add(display);
    seenProviders.add(provider);
    return true;
  });
}

function getConfiguredMarketAssets(forexSymbols = []) {
  if (!isHezilexCryptoMode()) {
    return forexSymbols.map((symbol) => ({ displayName: symbol, providerSymbol: symbol, marketMode: FOREX_MARKET_MODE }));
  }
  return uniqueAssets(getHezilexCryptoAssets());
}

function getCryptoMaxSymbolsPerCycle(mode = "balanced") {
  const configured = Number(process.env.CRYPTO_MAX_SYMBOLS_PER_CYCLE || 0);
  if (configured > 0) return configured;
  if (mode === "conservative") return 3;
  if (mode === "aggressive") return 7;
  return 5;
}

function getCryptoTimeframes() {
  return String(process.env.CRYPTO_TIMEFRAMES || "5min,15min,1h").split(",").map((item) => item.trim()).filter(Boolean);
}

function estimateAssetMetrics(asset) {
  const profile = CRYPTO_PROFILES[asset.category] || CRYPTO_PROFILES.large_mid_cap;
  return {
    volume: profile.liquidity.minVolume * (asset.liquidityTier === "tier_1" ? 3 : asset.liquidityTier === "tier_2" ? 1.5 : 1),
    spread: profile.spread.max * (asset.liquidityTier === "tier_1" ? 0.55 : 0.8),
    volatility: (profile.volatility.min + profile.volatility.max) / 2,
    candleCount: Math.max(Number(process.env.CRYPTO_MIN_CANDLES || 120), asset.minimumCandles)
  };
}

function isEligibleForMode(asset, strategyMode) {
  if (strategyMode !== "conservative") return true;
  return ["BITCOIN", "ETHEREUM", "BNB", "SOLANA"].includes(asset.displayName);
}

function selectCryptoAssetsForCycle({ strategyMode = "balanced" } = {}) {
  const adapter = new HezilexMarketAdapter();
  const configured = uniqueAssets(adapter.listSymbols());
  const maxSymbols = Math.min(getCryptoMaxSymbolsPerCycle(strategyMode), configured.length);
  const minVolume = Number(process.env.CRYPTO_MIN_VOLUME || 0);
  const maxSpread = Number(process.env.CRYPTO_MAX_SPREAD || 999);
  const minCandles = Number(process.env.CRYPTO_MIN_CANDLES || 120);
  const rejected = [];
  const eligible = configured.filter((asset) => {
    const metrics = estimateAssetMetrics(asset);
    const profile = CRYPTO_PROFILES[asset.category] || CRYPTO_PROFILES.large_mid_cap;
    let rejectionReason = null;
    if (!isEligibleForMode(asset, strategyMode)) rejectionReason = "conservative_mode_liquidity_filter";
    else if (metrics.volume < Math.max(minVolume, profile.liquidity.minVolume)) rejectionReason = "volume_below_minimum";
    else if (metrics.spread > Math.min(maxSpread, profile.spread.max)) rejectionReason = "spread_above_maximum";
    else if (metrics.candleCount < Math.max(minCandles, asset.minimumCandles)) rejectionReason = "insufficient_candles";
    else if (metrics.volatility < profile.volatility.min || metrics.volatility > profile.volatility.max) rejectionReason = "volatility_outside_profile";

    if (rejectionReason) rejected.push({ ...asset, metrics, rejectionReason });
    return !rejectionReason;
  });

  const ordered = [...eligible].sort((a, b) => a.priority - b.priority);
  const rotated = ordered.length ? [...ordered.slice(rotationCursor % ordered.length), ...ordered.slice(0, rotationCursor % ordered.length)] : [];
  const selected = rotated.slice(0, maxSymbols);
  rotationCursor = ordered.length ? (rotationCursor + selected.length) % ordered.length : 0;

  logCryptoAudit("asset_cycle_selection", {
    provider: adapter.providerName,
    symbolsConfigured: configured.map((asset) => asset.displayName),
    symbolsDiscovered: configured.map((asset) => asset.providerSymbol),
    symbolsEligible: eligible.map((asset) => asset.displayName),
    symbolsRejected: rejected.map((asset) => ({ displayName: asset.displayName, providerSymbol: asset.providerSymbol, rejectionReason: asset.rejectionReason })),
    selectedForCycle: selected.map((asset) => asset.displayName),
    timeframe: getCryptoTimeframes(),
    maxSymbolsPerCycle: maxSymbols
  });

  return selected;
}

function decorateCryptoResult(result, asset) {
  if (!asset) return result;
  return {
    ...result,
    symbol: asset.displayName,
    asset: asset.displayName,
    displayName: asset.displayName,
    display_name: asset.displayName,
    providerSymbol: asset.providerSymbol,
    provider_symbol: asset.providerSymbol,
    marketMode: HEZILEX_CRYPTO_MARKET_MODE,
    market_mode: HEZILEX_CRYPTO_MARKET_MODE,
    cryptoProfile: CRYPTO_PROFILES[asset.category] || null,
    currentSignal: result.currentSignal ? { ...result.currentSignal, symbol: asset.displayName, asset: asset.displayName, displayName: asset.displayName, providerSymbol: asset.providerSymbol, marketMode: HEZILEX_CRYPTO_MARKET_MODE } : result.currentSignal,
    signalCenter: result.signalCenter?.bestOpportunity ? {
      ...result.signalCenter,
      bestOpportunity: { ...result.signalCenter.bestOpportunity, symbol: asset.displayName, asset: asset.displayName, displayName: asset.displayName, providerSymbol: asset.providerSymbol, marketMode: HEZILEX_CRYPTO_MARKET_MODE }
    } : result.signalCenter,
    historyMeta: {
      display_name: asset.displayName,
      provider_symbol: asset.providerSymbol,
      market_mode: HEZILEX_CRYPTO_MARKET_MODE
    }
  };
}

module.exports = {
  FOREX_MARKET_MODE,
  decorateCryptoResult,
  findHezilexAsset,
  getConfiguredMarketAssets,
  getMarketMode,
  isHezilexCryptoMode,
  logCryptoAudit,
  selectCryptoAssetsForCycle
};
