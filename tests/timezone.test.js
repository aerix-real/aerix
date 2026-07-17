const test = require("node:test");
const assert = require("node:assert/strict");
const time = require("../src/utils/timezone");

test("normalizes UTC, offset and timezone-less timestamps to UTC", () => {
  assert.equal(time.toUtcIso("2026-07-16T18:25:00.000Z"), "2026-07-16T18:25:00.000Z");
  assert.equal(time.toUtcIso("2026-07-16T15:25:00-03:00"), "2026-07-16T18:25:00.000Z");
  assert.equal(time.toUtcIso("2026-07-16 18:25:00"), "2026-07-16T18:25:00.000Z");
  assert.equal(time.toUtcIso("invalid"), null);
});

test("formats day, month and year boundaries in Brasilia independently of host timezone", () => {
  assert.equal(time.formatBrasiliaDate("2026-07-01T01:00:00Z"), "30/06/2026");
  assert.equal(time.formatBrasiliaDate("2027-01-01T01:00:00Z"), "31/12/2026");
  assert.equal(time.formatBrasiliaTime("2026-07-16T18:23:42Z"), "15:23:42");
});

test("resolves all supported next candle boundaries in UTC", () => {
  const value = "2026-07-16T18:23:42Z";
  assert.equal(time.getNextCandleOpen(value, "M1").toISOString(), "2026-07-16T18:24:00.000Z");
  assert.equal(time.getNextCandleOpen(value, "M5").toISOString(), "2026-07-16T18:25:00.000Z");
  assert.equal(time.getNextCandleOpen(value, "M15").toISOString(), "2026-07-16T18:30:00.000Z");
  assert.equal(time.getNextCandleOpen(value, "H1").toISOString(), "2026-07-16T19:00:00.000Z");
});

test("expiration and remaining time compare absolute UTC instants", () => {
  const now = Date.parse("2026-07-16T18:24:30Z");
  assert.equal(time.calculateRemainingSeconds("2026-07-16T15:25:00-03:00", now), 30);
  assert.equal(time.isExpired("2026-07-16T18:24:29Z", now), true);
  assert.equal(time.isExpired("2026-07-16T18:25:00Z", now), false);
});
