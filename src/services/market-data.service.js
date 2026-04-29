const axios = require("axios");
const cacheService = require("./cache.service");

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = "https://api.twelvedata.com";

// 🔥 NOVO: controle de falhas
const errorMap = new Map();

function normalizeSymbol(symbol) {
  const raw = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (raw.includes("/")) return raw;

  if (/^[A-Z]{6}$/.test(raw)) {
    return `${raw.slice(0, 3)}/${raw.slice(3)}`;
  }

  return raw;
}

function parseNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildCacheKey(symbol, interval, outputsize) {
  return `timeseries:${symbol}:${interval}:${outputsize}`;
}

// 🔥 NOVO: TTL inteligente
function getDynamicTTL(interval) {
  if (interval === "5min") return 8000;
  if (interval === "15min") return 15000;
  if (interval === "1h") return 30000;
  return 12000;
}

// 🔥 NOVO: evitar ativos com erro
function shouldSkip(symbol) {
  const errorData = errorMap.get(symbol);
  if (!errorData) return false;

  const now = Date.now();

  // 30s bloqueado após erro
  return now - errorData < 30000;
}

function registerError(symbol) {
  errorMap.set(symbol, Date.now());
}

async function fetchTimeSeries(symbol, interval = "5min", outputsize = 30) {
  if (!API_KEY) {
    throw {
      statusCode: 500,
      message: "TWELVE_DATA_API_KEY não configurada."
    };
  }

  const normalized = normalizeSymbol(symbol);

  if (shouldSkip(normalized)) {
    throw {
      statusCode: 429,
      message: `Ativo temporariamente bloqueado por erro recente: ${symbol}`
    };
  }

  const cacheKey = buildCacheKey(normalized, interval, outputsize);

  const cached = cacheService.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await axios.get(`${BASE_URL}/time_series`, {
      params: {
        symbol: normalized,
        interval,
        outputsize,
        apikey: API_KEY,
        timezone: "UTC",
        format: "JSON"
      },
      timeout: 15000
    });

    const data = response.data;

    if (!data || data.status === "error") {
      registerError(normalized);
      throw {
        statusCode: 400,
        message: data?.message || `Erro ao consultar ${symbol} em ${interval}.`
      };
    }

    const values = Array.isArray(data.values) ? data.values : [];

    const parsedValues = values
      .map((candle) => ({
        datetime: candle.datetime,
        open: parseNumber(candle.open),
        high: parseNumber(candle.high),
        low: parseNumber(candle.low),
        close: parseNumber(candle.close),
        volume: parseNumber(candle.volume)
      }))
      .reverse();

    cacheService.set(
      cacheKey,
      parsedValues,
      getDynamicTTL(interval)
    );

    return parsedValues;
  } catch (error) {
    registerError(normalized);
    throw error;
  }
}

function getDirection(candles) {
  if (!candles || candles.length < 2) return "neutral";

  const first = candles[0].close;
  const last = candles[candles.length - 1].close;

  if (last > first) return "up";
  if (last < first) return "down";
  return "neutral";
}

function getStrengthPercent(candles) {
  if (!candles || candles.length < 2) return 0;

  const first = candles[0].close;
  const last = candles[candles.length - 1].close;

  if (!first) return 0;

  const variation = Math.abs(((last - first) / first) * 100);
  return Number(variation.toFixed(2));
}

function getVolatilityPercent(candles) {
  if (!candles || candles.length === 0) return 0;

  let totalRange = 0;
  let valid = 0;

  for (const candle of candles) {
    if (candle.close > 0) {
      totalRange += ((candle.high - candle.low) / candle.close) * 100;
      valid += 1;
    }
  }

  if (!valid) return 0;

  return Number((totalRange / valid).toFixed(2));
}

function getMomentumScore(candles) {
  if (!candles || candles.length < 3) return 0;

  const recent = candles.slice(-3);
  let score = 0;

  for (const candle of recent) {
    if (candle.close > candle.open) score += 1;
    if (candle.close < candle.open) score -= 1;
  }

  return score;
}

// 🔥 NOVO: qualidade geral do mercado
function getMarketQualitySnapshot(timeframe) {
  const strength = timeframe.strengthPercent || 0;
  const volatility = timeframe.volatilityPercent || 0;

  if (strength > 0.4 && volatility > 0.2) return "excellent";
  if (strength > 0.25) return "good";
  if (volatility < 0.1) return "bad";

  return "moderate";
}

async function getMarketSnapshot(symbol) {
  const [m5, m15, h1] = await Promise.all([
    fetchTimeSeries(symbol, "5min", 30),
    fetchTimeSeries(symbol, "15min", 30),
    fetchTimeSeries(symbol, "1h", 30)
  ]);

  const m5Data = {
    candles: m5,
    direction: getDirection(m5),
    strengthPercent: getStrengthPercent(m5),
    volatilityPercent: getVolatilityPercent(m5),
    momentumScore: getMomentumScore(m5)
  };

  const m15Data = {
    candles: m15,
    direction: getDirection(m15),
    strengthPercent: getStrengthPercent(m15),
    volatilityPercent: getVolatilityPercent(m15),
    momentumScore: getMomentumScore(m15)
  };

  const h1Data = {
    candles: h1,
    direction: getDirection(h1),
    strengthPercent: getStrengthPercent(h1),
    volatilityPercent: getVolatilityPercent(h1),
    momentumScore: getMomentumScore(h1)
  };

  return {
    symbol,
    timeframes: {
      m5: m5Data,
      m15: m15Data,
      h1: h1Data
    },

    // 🔥 NOVO BLOCO
    marketQuality: {
      m5: getMarketQualitySnapshot(m5Data),
      m15: getMarketQualitySnapshot(m15Data),
      h1: getMarketQualitySnapshot(h1Data)
    },

    timestamp: new Date().toISOString()
  };
}

module.exports = {
  fetchTimeSeries,
  getMarketSnapshot,
  normalizeSymbol
};