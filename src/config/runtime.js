function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  ENGINE_INTERVAL_MS: parseNumber(process.env.ENGINE_INTERVAL_MS, 15000),
  MAX_REQUESTS_PER_MINUTE: parseNumber(process.env.MAX_REQUESTS_PER_MINUTE, 8),
  MAX_SYMBOLS_PER_CYCLE: parseNumber(process.env.MAX_SYMBOLS_PER_CYCLE, 2),
  AUTO_START_ENGINE: String(process.env.AUTO_START_ENGINE || "true") === "true",
  DEFAULT_SYMBOLS: String(
    process.env.DEFAULT_SYMBOLS ||
      "EUR/USD,GBP/USD,USD/JPY,AUD/USD"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
};