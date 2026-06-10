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

const PROVIDER = "twelvedata";
const FALLBACK_SOURCE = "smart_fake_candles";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TIMEFRAME_CACHE_TTL_MS = Object.freeze({
  "5min": 60 * 1000,
  "15min": 180 * 1000,
  "1h": 300 * 1000
});
const TIMEFRAME_REPORT_KEYS = Object.freeze({
  "5min": "m5",
  "15min": "m15",
  "1h": "h1"
});
const DEFAULT_TIMEFRAME_TTL_MS = 60 * 1000;
const inFlightTimeSeriesRequests = new Map();
const twelveDataMetrics = {
  startedAt: new Date().toISOString(),
  providerRequests: 0,
  cacheHits: 0,
  inFlightHits: 0,
  fallbackRequests: 0,
  bySymbol: {},
  byTimeframe: {},
  byAssetTimeframe: {}
};

function sanitizeApiResponse(data) {
  if (!data || typeof data !== "object") return data ?? null;

  return {
    status: data.status || null,
    code: data.code || null,
    message: data.message || null,
    valuesCount: Array.isArray(data.values) ? data.values.length : null,
    hasValues: Array.isArray(data.values),
    meta: data.meta
      ? {
          symbol: data.meta.symbol || null,
          interval: data.meta.interval || null,
          currencyBase: data.meta.currency_base || null,
          currencyQuote: data.meta.currency_quote || null,
          exchangeTimezone: data.meta.exchange_timezone || null
        }
      : null
  };
}

function buildFallbackReason(reason, details = {}) {
  return {
    reason,
    timeout: Boolean(details.timeout),
    rateLimit: Boolean(details.rateLimit),
    credentials: Boolean(details.credentials),
    invalidEndpoint: Boolean(details.invalidEndpoint),
    parsing: Boolean(details.parsing),
    message: details.message || null,
    statusCode: details.statusCode || null
  };
}

function setCandlesAudit(candles, audit) {
  Object.defineProperty(candles, "audit", {
    value: audit,
    enumerable: false,
    configurable: true
  });

  return candles;
}

function getCandlesAudit(candles) {
  if (candles?.audit) return candles.audit;

  const isFallback = Array.isArray(candles) && candles.some((candle) => candle?.source === "fallback");

  return {
    provider: PROVIDER,
    providerStatus: isFallback ? "fallback_legacy" : "unknown",
    apiResponse: null,
    fallbackReason: isFallback ? buildFallbackReason("legacy_fallback_candles") : null,
    fallbackSource: isFallback ? FALLBACK_SOURCE : null,
    marketDataSource: isFallback ? "fallback" : "twelvedata"
  };
}

function logMarketDataAudit(event, payload = {}) {
  console.log(JSON.stringify({
    scope: "aerix_market_data_audit",
    event,
    timestamp: new Date().toISOString(),
    ...payload
  }));
}


function getTimeframeReportKey(interval) {
  return TIMEFRAME_REPORT_KEYS[interval] || interval;
}

function getTimeframeCacheTtlMs(interval) {
  return TIMEFRAME_CACHE_TTL_MS[interval] || DEFAULT_TIMEFRAME_TTL_MS;
}

function incrementCounter(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function trackTwelveDataRequest(symbol, interval) {
  const timeframe = getTimeframeReportKey(interval);
  twelveDataMetrics.providerRequests += 1;
  incrementCounter(twelveDataMetrics.bySymbol, symbol);
  incrementCounter(twelveDataMetrics.byTimeframe, timeframe);
  incrementCounter(twelveDataMetrics.byAssetTimeframe, `${symbol}:${timeframe}`);
}

function trackCacheHit() {
  twelveDataMetrics.cacheHits += 1;
}

function trackInFlightHit() {
  twelveDataMetrics.inFlightHits += 1;
}

function trackFallbackRequest() {
  twelveDataMetrics.fallbackRequests += 1;
}

function getConfiguredSymbols() {
  return String(process.env.SYMBOLS || process.env.DEFAULT_SYMBOLS || "EUR/USD,GBP/USD,USD/JPY,AUD/USD")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .map(normalizeSymbol);
}

function estimatePostCacheRequestsPerDay({ symbols, intervalMs, maxSymbolsPerCycle }) {
  const cyclesPerDay = Math.ceil(MS_PER_DAY / intervalMs);
  const symbolsPerCycle = Math.min(maxSymbolsPerCycle, symbols.length || maxSymbolsPerCycle);
  const visitsPerSymbolPerDay = symbols.length
    ? (cyclesPerDay * symbolsPerCycle) / symbols.length
    : 0;

  return symbols.reduce((total) => {
    const timeframeTotal = Object.entries(TIMEFRAME_CACHE_TTL_MS).reduce((sum, [, ttlMs]) => {
      const maxRequestsByCacheWindow = Math.ceil(MS_PER_DAY / ttlMs);
      return sum + Math.min(visitsPerSymbolPerDay, maxRequestsByCacheWindow);
    }, 0);

    return total + timeframeTotal;
  }, 0);
}

function buildTwelveDataConsumptionReport(options = {}) {
  const symbols = options.symbols?.length
    ? options.symbols.map(normalizeSymbol)
    : getConfiguredSymbols();
  const intervalMs = Number(options.intervalMs || process.env.ENGINE_INTERVAL_MS || 15000);
  const maxSymbolsPerCycle = Number(options.maxSymbolsPerCycle || process.env.MAX_SYMBOLS_PER_CYCLE || 2);
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 15000;
  const safeMaxSymbolsPerCycle = Number.isFinite(maxSymbolsPerCycle) && maxSymbolsPerCycle > 0 ? maxSymbolsPerCycle : 2;
  const symbolsPerCycle = Math.min(safeMaxSymbolsPerCycle, symbols.length || safeMaxSymbolsPerCycle);
  const timeframes = Object.keys(TIMEFRAME_CACHE_TTL_MS);
  const requestsPerAssetPerCycle = timeframes.length;
  const currentRequestsPerCycle = symbolsPerCycle * requestsPerAssetPerCycle;
  const cyclesPerDay = Math.ceil(MS_PER_DAY / safeIntervalMs);
  const estimatedDailyRequests = currentRequestsPerCycle * cyclesPerDay;
  const estimatedDailyRequestsAfterCache = Math.ceil(estimatePostCacheRequestsPerDay({
    symbols,
    intervalMs: safeIntervalMs,
    maxSymbolsPerCycle: safeMaxSymbolsPerCycle
  }));
  const reductionPercent = estimatedDailyRequests > 0
    ? Number((((estimatedDailyRequests - estimatedDailyRequestsAfterCache) / estimatedDailyRequests) * 100).toFixed(2))
    : 0;

  return {
    provider: PROVIDER,
    endpoint: `${BASE_URL}/time_series`,
    audit: {
      allTwelveDataCalls: ["fetchTimeSeries -> GET /time_series"],
      snapshotFlow: "getMarketSnapshot reutiliza um snapshot único com m5, m15 e h1 para todas as estratégias avaliadas no ciclo."
    },
    cacheTtlSeconds: Object.fromEntries(
      Object.entries(TIMEFRAME_CACHE_TTL_MS).map(([interval, ttlMs]) => [getTimeframeReportKey(interval), ttlMs / 1000])
    ),
    currentRequestsPerCycle,
    requestsPerAssetPerCycle,
    requestsPerTimeframePerAsset: Object.fromEntries(
      timeframes.map((interval) => [getTimeframeReportKey(interval), 1])
    ),
    configuredSymbols: symbols,
    symbolsPerCycle,
    cycleIntervalMs: safeIntervalMs,
    cyclesPerDay,
    estimatedDailyRequests,
    estimatedDailyRequestsAfterCache,
    expectedReductionAfterCache: {
      requestsPerDay: Math.max(0, estimatedDailyRequests - estimatedDailyRequestsAfterCache),
      percent: reductionPercent
    },
    observedRuntime: {
      ...twelveDataMetrics,
      bySymbol: { ...twelveDataMetrics.bySymbol },
      byTimeframe: { ...twelveDataMetrics.byTimeframe },
      byAssetTimeframe: { ...twelveDataMetrics.byAssetTimeframe },
      duplicateRequestsAvoided: twelveDataMetrics.cacheHits + twelveDataMetrics.inFlightHits
    }
  };
}

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

function markDailyLimit(apiResponse = null) {
  DAILY_LIMIT_REACHED = true;
  LAST_FALLBACK_AT = Date.now();
  console.log("🚨 LIMITE DIÁRIO ATINGIDO → fallback IA ativado");
  logMarketDataAudit("provider_daily_limit_reached", {
    provider: PROVIDER,
    providerStatus: "rate_limited",
    apiResponse,
    fallbackReason: buildFallbackReason("api_credits_limit", { rateLimit: true }),
    fallbackSource: FALLBACK_SOURCE,
    marketDataSource: "fallback"
  });
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

async function resolveTimeSeriesRequest(symbol, normalized, interval = "5min", outputsize = 120, cacheKey) {
  const cacheTtlMs = getTimeframeCacheTtlMs(interval);

  if (shouldUseFallback()) {
    LAST_FALLBACK_AT = Date.now();
    trackFallbackRequest();
    const fallbackReason = buildFallbackReason(
      process.env.USE_FAKE_DATA === "true" ? "use_fake_data_enabled" : "daily_limit_previously_reached",
      { rateLimit: DAILY_LIMIT_REACHED }
    );
    const audit = {
      provider: PROVIDER,
      providerStatus: "fallback_preflight",
      apiResponse: null,
      fallbackReason,
      fallbackSource: FALLBACK_SOURCE,
      marketDataSource: "fallback"
    };
    const fake = setCandlesAudit(await generateSmartFakeCandles(symbol, outputsize), audit);
    logMarketDataAudit("time_series_fallback_preflight", {
      symbol: normalized,
      interval,
      cacheKey,
      cacheTtlMs,
      ...audit
    });
    cacheService.set(cacheKey, fake, cacheTtlMs);
    return fake;
  }

  try {
    trackTwelveDataRequest(normalized, interval);
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
    const apiResponse = sanitizeApiResponse(data);

    if (data?.message?.includes("API credits")) {
      markDailyLimit(apiResponse);
      trackFallbackRequest();
      const fallbackReason = buildFallbackReason("api_credits_limit", { rateLimit: true });
      const audit = {
        provider: PROVIDER,
        providerStatus: "rate_limited",
        apiResponse,
        fallbackReason,
        fallbackSource: FALLBACK_SOURCE,
        marketDataSource: "fallback"
      };
      const fake = setCandlesAudit(await generateSmartFakeCandles(symbol, outputsize), audit);
      logMarketDataAudit("time_series_fallback", {
        symbol: normalized,
        interval,
        cacheKey,
        cacheTtlMs,
        ...audit
      });
      cacheService.set(cacheKey, fake, cacheTtlMs);
      return fake;
    }

    if (!data?.values || !Array.isArray(data.values)) {
      const invalidResponseError = new Error("Dados inválidos da API");
      invalidResponseError.audit = {
        apiResponse,
        fallbackReason: buildFallbackReason("invalid_api_payload", {
          parsing: true,
          message: data?.message || "values ausente ou inválido"
        })
      };
      throw invalidResponseError;
    }

    const normalizedCandles = data.values
      .map((c) => ({
        datetime: c.datetime,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume)
      }));

    const malformedCandle = normalizedCandles.find((candle) =>
      !candle.datetime ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close) ||
      !Number.isFinite(candle.volume)
    );

    if (malformedCandle) {
      const parsingError = new Error("Erro de parsing nos candles da API");
      parsingError.audit = {
        apiResponse,
        fallbackReason: buildFallbackReason("invalid_candle_payload", {
          parsing: true,
          message: "Campos OHLCV ausentes ou não numéricos"
        })
      };
      throw parsingError;
    }

    const parsed = setCandlesAudit(normalizedCandles.reverse(), {
      provider: PROVIDER,
      providerStatus: "success",
      apiResponse,
      fallbackReason: null,
      fallbackSource: null,
      marketDataSource: "twelvedata"
    });

    logMarketDataAudit("time_series_success", {
      symbol: normalized,
      interval,
      cacheKey,
      cacheTtlMs,
      provider: PROVIDER,
      providerStatus: "success",
      apiResponse,
      fallbackReason: null,
      fallbackSource: null,
      marketDataSource: "twelvedata"
    });

    cacheService.set(cacheKey, parsed, cacheTtlMs);

    return parsed;

  } catch (err) {
    console.log("⚠️ API falhou → usando IA offline");

    LAST_FALLBACK_AT = Date.now();
    trackFallbackRequest();
    const axiosCode = err?.code || null;
    const statusCode = err?.response?.status || null;
    const apiResponse = err?.audit?.apiResponse || sanitizeApiResponse(err?.response?.data);
    const fallbackReason = err?.audit?.fallbackReason || buildFallbackReason("provider_request_failed", {
      timeout: axiosCode === "ECONNABORTED" || /timeout/i.test(err?.message || ""),
      rateLimit: statusCode === 429 || /rate limit|too many requests|api credits/i.test(err?.message || ""),
      credentials: statusCode === 401 || statusCode === 403 || /api key|apikey|unauthorized|forbidden/i.test(err?.message || ""),
      invalidEndpoint: statusCode === 404,
      parsing: /json|parse|invalid|Dados inválidos/i.test(err?.message || ""),
      message: err?.message || null,
      statusCode
    });
    const audit = {
      provider: PROVIDER,
      providerStatus: statusCode ? `http_error_${statusCode}` : "request_error",
      apiResponse,
      fallbackReason,
      fallbackSource: FALLBACK_SOURCE,
      marketDataSource: "fallback"
    };
    const fake = setCandlesAudit(await generateSmartFakeCandles(symbol, outputsize), audit);
    logMarketDataAudit("time_series_fallback", {
      symbol: normalized,
      interval,
      cacheKey,
      cacheTtlMs,
      ...audit
    });
    cacheService.set(cacheKey, fake, cacheTtlMs);

    return fake;
  }
}

async function fetchTimeSeries(symbol, interval = "5min", outputsize = 120) {
  const normalized = normalizeSymbol(symbol);
  const cacheKey = `${PROVIDER}:time_series:${normalized}:${interval}:${outputsize}`;
  const cacheTtlMs = getTimeframeCacheTtlMs(interval);

  const cached = cacheService.get(cacheKey);
  if (cached) {
    trackCacheHit();
    const audit = getCandlesAudit(cached);
    logMarketDataAudit("time_series_cache_hit", {
      symbol: normalized,
      interval,
      cacheKey,
      cacheTtlMs,
      provider: audit.provider,
      providerStatus: "cache_hit",
      apiResponse: audit.apiResponse,
      fallbackReason: audit.fallbackReason,
      fallbackSource: audit.fallbackSource,
      marketDataSource: audit.marketDataSource
    });
    return cached;
  }

  const inFlight = inFlightTimeSeriesRequests.get(cacheKey);
  if (inFlight) {
    trackInFlightHit();
    logMarketDataAudit("time_series_inflight_reuse", {
      symbol: normalized,
      interval,
      cacheKey,
      cacheTtlMs,
      provider: PROVIDER,
      providerStatus: "inflight_reuse",
      marketDataSource: shouldUseFallback() ? "fallback" : "twelvedata"
    });
    return inFlight;
  }

  const request = resolveTimeSeriesRequest(symbol, normalized, interval, outputsize, cacheKey)
    .finally(() => {
      inFlightTimeSeriesRequests.delete(cacheKey);
    });

  inFlightTimeSeriesRequests.set(cacheKey, request);
  return request;
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

  const audits = {
    m5: getCandlesAudit(m5),
    m15: getCandlesAudit(m15),
    h1: getCandlesAudit(h1)
  };
  const hasFallbackCandles = [m5, m15, h1].some((candles) =>
    Array.isArray(candles) && candles.some((candle) => candle?.source === "fallback")
  );
  const fallbackConditions = {
    preflightFallbackEnabled: usedFallback,
    dailyLimitReached: DAILY_LIMIT_REACHED,
    fallbackDuringSnapshot: LAST_FALLBACK_AT >= snapshotStartedAt,
    hasFallbackCandles,
    useFakeDataEnabled: process.env.USE_FAKE_DATA === "true"
  };

  const source = Object.values(fallbackConditions).some(Boolean)
    ? "fallback"
    : "twelvedata";
  const providerStatus = source === "fallback"
    ? Object.values(audits).find((audit) => audit.marketDataSource === "fallback")?.providerStatus || "fallback"
    : "success";
  const fallbackAudit = Object.values(audits).find((audit) => audit.marketDataSource === "fallback") || null;

  logMarketDataAudit("market_snapshot_resolved", {
    symbol,
    provider: PROVIDER,
    providerStatus,
    apiResponse: fallbackAudit?.apiResponse || Object.values(audits).find((audit) => audit.apiResponse)?.apiResponse || null,
    fallbackReason: fallbackAudit?.fallbackReason || null,
    fallbackSource: fallbackAudit?.fallbackSource || null,
    marketDataSource: source,
    consumptionReport: buildTwelveDataConsumptionReport(),
    fallbackConditions,
    timeframes: {
      m5: { providerStatus: audits.m5.providerStatus, marketDataSource: audits.m5.marketDataSource, fallbackReason: audits.m5.fallbackReason },
      m15: { providerStatus: audits.m15.providerStatus, marketDataSource: audits.m15.marketDataSource, fallbackReason: audits.m15.fallbackReason },
      h1: { providerStatus: audits.h1.providerStatus, marketDataSource: audits.h1.marketDataSource, fallbackReason: audits.h1.fallbackReason }
    }
  });

  return {
    symbol,
    source,
    isFallback: source === "fallback",
    dataQuality: {
      source,
      provider: PROVIDER,
      providerStatus,
      apiResponse: fallbackAudit?.apiResponse || Object.values(audits).find((audit) => audit.apiResponse)?.apiResponse || null,
      fallbackReason: fallbackAudit?.fallbackReason || null,
      fallbackSource: fallbackAudit?.fallbackSource || null,
      marketDataSource: source,
      consumptionReport: buildTwelveDataConsumptionReport(),
      fallbackConditions,
      timeframeAudits: audits,
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
  const safeSymbol = String(symbol || "").trim();

  if (!safeSymbol) return safeSymbol;
  return safeSymbol.includes("/")
    ? safeSymbol
    : `${safeSymbol.slice(0, 3)}/${safeSymbol.slice(3)}`;
}

async function getMarketStatus() {
  return {
    provider: PROVIDER,
    dailyLimitReached: DAILY_LIMIT_REACHED,
    useFakeDataEnabled: process.env.USE_FAKE_DATA === "true",
    consumptionReport: buildTwelveDataConsumptionReport()
  };
}

module.exports = {
  fetchTimeSeries,
  getMarketSnapshot,
  getMarketStatus,
  buildTwelveDataConsumptionReport
};
