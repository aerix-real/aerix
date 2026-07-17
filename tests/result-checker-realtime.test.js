const test = require("node:test");
const assert = require("node:assert/strict");
const resultChecker = require("../src/services/result-checker.service");

test("classifica CALL e PUT sem alterar a regra operacional", () => {
  assert.equal(resultChecker.resolveSignalResult({ entry_price: 100, signal: "CALL" }, 101), "win");
  assert.equal(resultChecker.resolveSignalResult({ entry_price: 100, signal: "CALL" }, 99), "loss");
  assert.equal(resultChecker.resolveSignalResult({ entry_price: 100, signal: "PUT" }, 99), "win");
  assert.equal(resultChecker.resolveSignalResult({ entry_price: 100, signal: "PUT" }, 101), "loss");
});

test("normaliza empate com precisão do provider", () => {
  const signal = { entry_price: 100, signal: "CALL", meta: { provider_precision: 4 } };
  assert.equal(resultChecker.resolveSignalResult(signal, 100.00001), "draw");
});

test("aceita somente o candle fechado que contém a expiração", () => {
  const signal = { expires_at: "2026-07-17T15:30:00.000Z" };
  const open = { datetime: "2026-07-17T15:30:00.000Z", close: 101, closed: false };
  const matching = { datetime: "2026-07-17T15:25:00.000Z", close: 100, closed: true };
  assert.equal(resultChecker.getConfirmedExpirationCandle(signal, [open, matching], Date.parse("2026-07-17T15:30:01.000Z")), matching);
  assert.equal(resultChecker.getConfirmedExpirationCandle(signal, [open], Date.parse("2026-07-17T15:31:00.000Z")), null);
});

test("limita tentativas aos atrasos controlados", () => {
  const signal = { id: "retry-test", expires_at: "2026-07-17T15:30:00.000Z" };
  const expiry = Date.parse(signal.expires_at);
  assert.equal(resultChecker.shouldAttempt(signal, expiry), true);
  assert.equal(resultChecker.shouldAttempt(signal, expiry), false);
  assert.equal(resultChecker.shouldAttempt(signal, expiry + 1000), true);
  assert.equal(resultChecker.shouldAttempt(signal, expiry + 3000), true);
  assert.equal(resultChecker.shouldAttempt(signal, expiry + 5000), true);
  assert.equal(resultChecker.shouldAttempt(signal, expiry + 10000), true);
  assert.equal(resultChecker.shouldAttempt(signal, expiry + 60000), false);
  resultChecker.retryState.delete(signal.id);
});
