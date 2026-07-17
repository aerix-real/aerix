const OPERATIONAL_TIMEZONE = "America/Sao_Paulo";
const STORAGE_TIMEZONE = "UTC";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function emitTimezoneAudit(event, details = {}) {
  console.log(JSON.stringify({
    scope: "aerix_timezone_audit",
    event,
    timestamp: new Date().toISOString(),
    operationalTimezone: OPERATIONAL_TIMEZONE,
    ...details
  }));
}

function parseUtcTimestamp(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;

  let candidate = value;
  if (typeof value === "number") candidate = value < 10_000_000_000 ? value * 1000 : value;
  if (typeof candidate === "string") {
    candidate = candidate.trim();
    if (/^\d+$/.test(candidate)) return parseUtcTimestamp(Number(candidate), options);
    // PostgreSQL may return a timestamp without a designator. Treat legacy values as UTC,
    // never as the host timezone, so Render and developer machines behave identically.
    if (!TIMEZONE_PATTERN.test(candidate)) {
      candidate = DATE_ONLY_PATTERN.test(candidate)
        ? `${candidate}T00:00:00.000Z`
        : `${candidate.replace(" ", "T")}Z`;
    }
  }

  const parsed = candidate instanceof Date ? new Date(candidate.getTime()) : new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    emitTimezoneAudit("invalid_timestamp_detected", { rawTimestamp: String(value), source: options.source || "unknown" });
    return null;
  }

  if (options.audit) {
    emitTimezoneAudit("timestamp_normalized", {
      rawTimestamp: String(value),
      normalizedUtc: parsed.toISOString(),
      displayedBrasilia: formatBrasiliaDateTime(parsed),
      source: options.source || "unknown",
      symbol: options.symbol,
      timeframe: options.timeframe,
      signalId: options.signalId
    });
  }
  return parsed;
}

function toUtcIso(value = new Date(), options = {}) {
  return parseUtcTimestamp(value, options)?.toISOString() || null;
}

function formatter(options) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: OPERATIONAL_TIMEZONE, hour12: false, ...options });
}

function formatValue(value, options) {
  const date = parseUtcTimestamp(value);
  return date ? formatter(options).format(date).replace("24:", "00:") : "--";
}

function formatBrasiliaDateTime(value) {
  return formatValue(value, { dateStyle: "short", timeStyle: "medium" });
}

function formatBrasiliaTime(value) {
  return formatValue(value, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatBrasiliaDate(value) {
  return formatValue(value, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function getBrasiliaNow() {
  const utc = new Date();
  return { utc, utcIso: utc.toISOString(), displayed: formatBrasiliaDateTime(utc), timeZone: OPERATIONAL_TIMEZONE };
}

function resolveTimeframeMinutes(timeframe) {
  if (typeof timeframe === "number" && Number.isFinite(timeframe) && timeframe > 0) return timeframe;
  const normalized = String(timeframe || "").trim().toUpperCase();
  const supported = { M1: 1, M5: 5, M15: 15, H1: 60 };
  if (!supported[normalized]) throw new RangeError(`Unsupported timeframe: ${timeframe}`);
  return supported[normalized];
}

function getNextCandleOpen(timestamp, timeframe) {
  const date = parseUtcTimestamp(timestamp);
  if (!date) return null;
  const intervalMs = resolveTimeframeMinutes(timeframe) * 60_000;
  const next = new Date((Math.floor(date.getTime() / intervalMs) + 1) * intervalMs);
  return next;
}

function getCandleCloseTime(timestamp, timeframe) {
  const open = parseUtcTimestamp(timestamp);
  return open ? new Date(open.getTime() + resolveTimeframeMinutes(timeframe) * 60_000) : null;
}

function calculateRemainingSeconds(targetTimestamp, now = Date.now()) {
  const target = parseUtcTimestamp(targetTimestamp);
  return target ? Math.max(0, Math.ceil((target.getTime() - Number(now)) / 1000)) : 0;
}

function isExpired(expiresAt, now = Date.now()) {
  const target = parseUtcTimestamp(expiresAt);
  return !target || target.getTime() <= Number(now);
}

emitTimezoneAudit("timezone_initialized", { storageTimezone: STORAGE_TIMEZONE });

module.exports = {
  OPERATIONAL_TIMEZONE, STORAGE_TIMEZONE, parseUtcTimestamp, toUtcIso,
  formatBrasiliaDateTime, formatBrasiliaTime, formatBrasiliaDate, getBrasiliaNow,
  getNextCandleOpen, getCandleCloseTime, isExpired, calculateRemainingSeconds,
  emitTimezoneAudit
};
