const axios = require("axios");
const cacheService = require("./cache.service");
const signalRepository = require("../repositories/signal.repository");

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = "https://api.twelvedata.com";

// =========================
// 🔥 CONTROLE GLOBAL
// =========================

let DAILY_LIMIT_REACHED = false;
let lastStatsCache = null;
let lastStatsTime = 0;
let LAST_FALLBACK_AT = 0;

// =========================
// 🧠 OTIMIZAÇÃO DE STATS
// =========================

async function getCachedStats() {
  const now = Date.now();

  if (lastStatsCache && now - lastStatsTime < 60000) {
    return lastStatsCache;
  }

  lastStatsCache = await signalRepository.getStats();
  lastStatsTime = now;

  return lastStatsCache;
}

// =========================
// 🧠 IA OFFLINE INTELIGENTE
// =========================

async function generateSmartFakeCandles(symbol, outputsize = 120) {
  const stats = await getCachedStats();

  const symbolStats = stats?.bySymbol?.[symbol];
  const trendBias = symbolStats?.winrate >= 60 ? 1 : -1;

  const candles = [];
  let price = 1 + Math.random();

  for (let i = 0; i < outputsize; i++) {
    const direction = (Math.random() - 0.5 + trendBias * 0.2);

    const open = price;
    const close = open + direction * 0.01;

    const high = Math.max(open, close) + Math.random() * 0.005;
    const low = Math.min(open, close) - Math.random() * 0.005;

    candles.push({
      datetime: new Date().toISOString(),
      open,
      close,
      high,
      low,
      volume: Math.random() * 100,
      source: "fallback"
    });

    price = close;
  }

  return candles;
}

// =========================
// 🔥 FALLBACK CONTROL
// =========================

function markDailyLimit() {
  DAILY_LIMIT_REACHED = true;
  LAST_FALLBACK_AT = Date.now();
  console.log("🚨 LIMITE DIÁRIO ATINGIDO → fallback IA ativado");
}

function shouldUseFallback() {
  return (
    process.env.USE_FAKE_DATA === "true" ||
    DAILY_LIMIT_REACHED
  );
}

// =========================
// 🚀 FETCH PRINCIPAL
// =========================

async function fetchTimeSeries(symbol, interval = "5min", outputsize = 120) {
  const normalized = normalizeSymbol(symbol);
  const cacheKey = `${normalized}:${interval}`;

  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  if (shouldUseFallback()) {
    LAST_FALLBACK_AT = Date.now();
    const fake = await generateSmartFakeCandles(symbol, outputsize);
    cacheService.set(cacheKey, fake, 5000);
    return fake;
  }

  try {
    const response = await axios.get(`${BASE_URL}/time_series`, {
      params: {
        symbol: normalized,
        interval,
        outputsize,
        apikey: API_KEY
      },
      timeout: 8000
    });

    const data = response.data;

    if (data?.message?.includes("API credits")) {
      markDailyLimit();
      return await generateSmartFakeCandles(symbol, outputsize);
    }

    if (!data?.values || !Array.isArray(data.values)) {
      throw new Error("Dados inválidos da API");
    }

    const parsed = data.values
      .map((c) => ({
        datetime: c.datetime,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume)
      }))
      .reverse();

    cacheService.set(cacheKey, parsed, 10000);

    return parsed;

  } catch (err) {
    console.log("⚠️ API falhou → usando IA offline");

    LAST_FALLBACK_AT = Date.now();
    const fake = await generateSmartFakeCandles(symbol, outputsize);
    cacheService.set(cacheKey, fake, 5000);

    return fake;
  }
}

// =========================
// 🧠 SNAPSHOT HELPERS
// =========================

function safeGet(candles) {
  if (!candles || candles.length === 0) return null;
  return candles;
}

function getDirection(candles) {
  candles = safeGet(candles);
  if (!candles) return "neutral";

  const first = candles[0].close;
  const last = candles[candles.length - 1].close;

  if (last > first) return "up";
  if (last < first) return "down";
  return "neutral";
}

function getStrengthPercent(candles) {
  candles = safeGet(candles);
  if (!candles) return 0;

  const first = candles[0].close;
  const last = candles[candles.length - 1].close;

  return Math.abs(((last - first) / first) * 100);
}

function getVolatilityPercent(candles) {
  candles = safeGet(candles);
  if (!candles) return 0;

  let total = 0;

  candles.forEach(c => {
    total += ((c.high - c.low) / c.close) * 100;
  });

  return total / candles.length;
}

// =========================
// 🚀 SNAPSHOT FINAL
// =========================

async function getMarketSnapshot(symbol) {
  const snapshotStartedAt = Date.now();
  const usedFallback = shouldUseFallback();

  const [m5, m15, h1] = await Promise.all([
    fetchTimeSeries(symbol, "5min"),
    fetchTimeSeries(symbol, "15min"),
    fetchTimeSeries(symbol, "1h")
  ]);

  const hasFallbackCandles = [m5, m15, h1].some((candles) =>
    Array.isArray(candles) && candles.some((candle) => candle?.source === "fallback")
  );

  const source = usedFallback ||
    DAILY_LIMIT_REACHED ||
    LAST_FALLBACK_AT >= snapshotStartedAt ||
    hasFallbackCandles ||
    process.env.USE_FAKE_DATA === "true"
    ? "fallback"
    : "twelvedata";

  return {
    symbol,
    source,
    isFallback: source === "fallback",
    dataQuality: {
      source,
      isFallback: source === "fallback",
      operational: source !== "fallback",
      candles: {
        m5: m5.length,
        m15: m15.length,
        h1: h1.length
      },
      minimumCandles: 60
    },
    timeframes: {
      m5: {
        candles: m5,
        direction: getDirection(m5),
        strengthPercent: getStrengthPercent(m5),
        volatilityPercent: getVolatilityPercent(m5)
      },
      m15: {
        candles: m15,
        direction: getDirection(m15),
        strengthPercent: getStrengthPercent(m15),
        volatilityPercent: getVolatilityPercent(m15)
      },
      h1: {
        candles: h1,
        direction: getDirection(h1),
        strengthPercent: getStrengthPercent(h1),
        volatilityPercent: getVolatilityPercent(h1)
      }
    },
    timestamp: new Date().toISOString()
  };
}

// =========================
// 🔧 UTIL
// =========================

function normalizeSymbol(symbol) {
  return symbol.includes("/")
    ? symbol
    : `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
}

module.exports = {
  fetchTimeSeries,
  getMarketSnapshot
};
