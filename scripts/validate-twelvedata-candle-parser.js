require("dotenv").config();

const axios = require("axios");
const marketData = require("../src/services/market-data.service");

const BASE_URL = "https://api.twelvedata.com";
const VALIDATION_SYMBOLS = Object.freeze(["AUD/USD", "EUR/USD", "GBP/USD", "USD/JPY"]);
const SAMPLE_CANDLES = Object.freeze({
  "AUD/USD": { datetime: "2026-06-11 10:00:00", open: "0.65120", high: "0.65180", low: "0.65090", close: "0.65150" },
  "EUR/USD": { datetime: "2026-06-11 10:00:00", open: "1.08420", high: "1.08490", low: "1.08370", close: "1.08460", volume: "0" },
  "GBP/USD": { datetime: "2026-06-11 10:00:00", open: "1.27420", high: "1.27510", low: "1.27380", close: "1.27470", volume: 0 },
  "USD/JPY": { datetime: "2026-06-11 10:00:00", open: "156.120", high: "156.250", low: "155.980", close: "156.070", volume: "" }
});

function validateRawCandle(symbol, rawCandle) {
  const diagnostics = marketData._internals.describeCandleFields(rawCandle);
  const normalized = marketData._internals.normalizeTwelveDataCandle(rawCandle);
  const malformed = marketData._internals.findMalformedCandle([normalized]);

  return {
    symbol,
    accepted: !malformed,
    rawCandle,
    normalized,
    expectedFields: diagnostics.expectedFields,
    receivedFields: diagnostics.receivedFields,
    missingFields: diagnostics.missingFields,
    nonNumericFields: diagnostics.nonNumericFields,
    fieldDiagnostics: diagnostics.fieldDiagnostics
  };
}

function runFixtureValidation() {
  return VALIDATION_SYMBOLS.map((symbol) => validateRawCandle(symbol, SAMPLE_CANDLES[symbol]));
}

async function runLiveValidation() {
  if (!process.env.TWELVE_DATA_API_KEY) {
    throw new Error("TWELVE_DATA_API_KEY ausente para validação live");
  }

  const responses = await Promise.all(VALIDATION_SYMBOLS.map(async (symbol) => {
    const response = await axios.get(`${BASE_URL}/time_series`, {
      params: {
        symbol,
        interval: "5min",
        outputsize: 1,
        apikey: process.env.TWELVE_DATA_API_KEY
      },
      timeout: 8000
    });

    const rawCandle = Array.isArray(response.data?.values) ? response.data.values[0] : null;
    return {
      apiStatus: response.data?.status || null,
      valuesCount: Array.isArray(response.data?.values) ? response.data.values.length : 0,
      hasValues: Array.isArray(response.data?.values),
      ...validateRawCandle(symbol, rawCandle)
    };
  }));

  return responses;
}

async function main() {
  const live = process.argv.includes("--live");
  const results = live ? await runLiveValidation() : runFixtureValidation();

  console.log(JSON.stringify({
    scope: "aerix_twelvedata_candle_parser_validation",
    mode: live ? "live" : "fixture",
    symbols: VALIDATION_SYMBOLS,
    results
  }, null, 2));

  const rejected = results.filter((result) => !result.accepted);
  if (rejected.length) {
    console.error(`Rejected symbols: ${rejected.map((result) => result.symbol).join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
