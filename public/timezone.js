(function exposeAerixTime(global) {
  const OPERATIONAL_TIMEZONE = "America/Sao_Paulo";
  const STORAGE_TIMEZONE = "UTC";
  const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: OPERATIONAL_TIMEZONE, dateStyle: "short", timeStyle: "medium", hour12: false });
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: OPERATIONAL_TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  function parseUtcTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    if (typeof value === "number") value = value < 10000000000 ? value * 1000 : value;
    if (typeof value === "string" && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
      value = `${value.trim().replace(" ", "T")}Z`;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function clean(value) { return value.replace("24:", "00:"); }
  function formatBrasiliaTime(value) { const parsed = parseUtcTimestamp(value); return parsed ? clean(time.format(parsed)) : "--"; }
  function formatBrasiliaDateTime(value) { const parsed = parseUtcTimestamp(value); return parsed ? clean(dateTime.format(parsed)) : "--"; }
  function calculateRemainingSeconds(target, now = Date.now()) {
    const parsed = parseUtcTimestamp(target);
    return parsed ? Math.max(0, Math.ceil((parsed.getTime() - now) / 1000)) : 0;
  }

  global.AerixTime = { OPERATIONAL_TIMEZONE, STORAGE_TIMEZONE, parseUtcTimestamp, formatBrasiliaTime, formatBrasiliaDateTime, calculateRemainingSeconds };
})(window);
