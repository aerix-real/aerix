const dotenv = require("dotenv");

dotenv.config();

function required(name, fallback = "") {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === null || value === "") {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }

  return value;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "sim"].includes(normalized)) return true;
  if (["false", "0", "no", "nao", "não"].includes(normalized)) return false;

  return fallback;
}

const env = {
  app: {
    name: process.env.APP_NAME || "AERIX",
    nodeEnv: process.env.NODE_ENV || "development",
    port: toNumber(process.env.PORT, 3000),
    debug: toBoolean(process.env.DEBUG, true)
  },

  cors: {
    origin: process.env.CORS_ORIGIN || "*"
  },

  db: {
    url: required("DATABASE_URL")
  },

  auth: {
    jwtSecret: required("JWT_SECRET"),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    bcryptSaltRounds: toNumber(process.env.BCRYPT_SALT_ROUNDS, 10)
  },

  engine: {
    mode: process.env.MODE || "equilibrado",
    intervalMs: toNumber(process.env.ENGINE_INTERVAL_MS, 5 * 60 * 1000),
    resultCheckIntervalMs: toNumber(process.env.RESULT_CHECK_INTERVAL_MS, 10000),
    rankingIntervalMs: toNumber(process.env.RANKING_INTERVAL_MS, 30000),
    expirationMinutes: toNumber(process.env.EXPIRATION_MINUTES, 1),
    timeframe: process.env.TIMEFRAME || "M5"
  },

  filters: {
    minScoreConservador: toNumber(process.env.MIN_SCORE_CONSERVADOR, 90),
    minScoreEquilibrado: toNumber(process.env.MIN_SCORE_EQUILIBRADO, 82),
    minScoreAgressivo: toNumber(process.env.MIN_SCORE_AGRESSIVO, 74),
    minProbability: toNumber(process.env.MIN_PROBABILITY, 45)
  },

  market: {
    mode: process.env.MARKET_MODE || "FOREX",
    cryptoProvider: process.env.CRYPTO_PROVIDER || "",
    cryptoMaxSymbolsPerCycle: toNumber(process.env.CRYPTO_MAX_SYMBOLS_PER_CYCLE, 5),
    cryptoMinVolume: toNumber(process.env.CRYPTO_MIN_VOLUME, 0),
    cryptoMaxSpread: toNumber(process.env.CRYPTO_MAX_SPREAD, 999),
    cryptoMinCandles: toNumber(process.env.CRYPTO_MIN_CANDLES, 120),
    cryptoTimeframes: String(process.env.CRYPTO_TIMEFRAMES || "5min,15min,1h")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    symbols: String(process.env.SYMBOLS || "EUR/USD,GBP/USD,USD/JPY")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
};

module.exports = env;