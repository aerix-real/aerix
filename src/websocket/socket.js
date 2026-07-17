const crypto = require("crypto");

let ioInstance = null;
let heartbeatTimer = null;
let sequenceNumber = 0;
let snapshotProvider = async () => ({});
const latestEvents = new Map();

const HEARTBEAT_INTERVAL_MS = Math.max(5000, Number(process.env.REALTIME_HEARTBEAT_MS || 5000));

function audit(event, fields = {}) {
  console.log(JSON.stringify({
    scope: "aerix_realtime_terminal_audit",
    event,
    timestamp: new Date().toISOString(),
    ...fields
  }));
}

function createEnvelope(event, payload = {}, context = {}) {
  const serverTimestamp = new Date().toISOString();
  sequenceNumber += 1;
  return {
    eventId: crypto.randomUUID(),
    serverTimestamp,
    sequenceNumber,
    symbol: context.symbol || payload.symbol || null,
    displayName: context.displayName || payload.displayName || payload.display_name || payload.symbol || null,
    marketMode: context.marketMode || payload.marketMode || payload.market_mode || process.env.TRADING_MODE || "balanced",
    payload
  };
}

function setSnapshotProvider(provider) {
  snapshotProvider = typeof provider === "function" ? provider : snapshotProvider;
}

async function sendSnapshot(socket) {
  audit("terminal_snapshot_requested", { socketId: socket.id });
  try {
    const snapshot = await snapshotProvider();
    const envelope = createEnvelope("terminal:snapshot", {
      serverTimestamp: new Date().toISOString(),
      ...snapshot
    });
    socket.emit("terminal:snapshot", envelope);
    audit("terminal_snapshot_sent", { eventId: envelope.eventId, socketId: socket.id });
  } catch (error) {
    audit("terminal_snapshot_sent", { socketId: socket.id, error: error.message, broadcastStatus: "failed" });
  }
}

function emitHeartbeat() {
  if (!ioInstance) return;
  const state = snapshotProvider({ lightweight: true });
  Promise.resolve(state).then((snapshot = {}) => {
    const statuses = snapshot.statuses || {};
    const payload = {
      serverTimestamp: new Date().toISOString(),
      engineOnline: Boolean(statuses.engineOnline),
      feedOnline: Boolean(statuses.feedOnline),
      aiOnline: statuses.aiOnline !== false,
      socketOnline: true,
      lastCycleAt: statuses.lastCycleAt || null,
      lastMarketDataAt: statuses.lastMarketDataAt || null
    };
    const envelope = emitToAll("system:heartbeat", payload, { volatile: true });
    audit("heartbeat_emitted", { eventId: envelope?.eventId, broadcastStatus: envelope ? "sent" : "skipped" });
  }).catch(() => {});
}

function initializeSocket(io) {
  ioInstance = io;
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(emitHeartbeat, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }

  io.on("connection", (socket) => {
    socket.emit("system:status", { connected: true, timestamp: new Date().toISOString() });
    for (const [event, envelope] of latestEvents.entries()) socket.emit(event, envelope);
    socket.on("runtime:ping", () => socket.volatile.emit("runtime:pong", { timestamp: new Date().toISOString() }));
    socket.on("terminal:snapshot", () => sendSnapshot(socket));
    sendSnapshot(socket);
  });
  return ioInstance;
}

function getIO() {
  return ioInstance;
}

function emitToAll(event, payload, options = {}) {
  const envelope = createEnvelope(event, payload, options);
  const legacyEvents = new Set(["signal", "bestOpportunity", "history", "execution", "engine:update", "filter-analytics:update", "signal-result-updated"]);
  const outbound = legacyEvents.has(event) ? payload : envelope;
  if (options.cacheLatest) latestEvents.set(event, outbound);
  if (!ioInstance || ioInstance.engine?.clientsCount === 0) return envelope;
  if (options.volatile) ioInstance.volatile.emit(event, outbound);
  else ioInstance.emit(event, outbound);
  audit("realtime_event_emitted", { event, eventId: envelope.eventId, symbol: envelope.symbol, broadcastStatus: "sent" });
  return envelope;
}

module.exports = { initializeSocket, getIO, emitToAll, setSnapshotProvider, createEnvelope };
