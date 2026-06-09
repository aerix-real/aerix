let ioInstance = null;
const latestEvents = new Map();

const HEARTBEAT_TIMESTAMP_REFRESH_MS = 250;
let sharedTimestamp = new Date().toISOString();
let cachedSystemStatusPayload = Object.freeze({
  connected: true,
  timestamp: sharedTimestamp
});
let cachedRuntimePongPayload = Object.freeze({
  timestamp: sharedTimestamp
});
let heartbeatPayloadTimer = null;

function refreshHeartbeatPayloads() {
  sharedTimestamp = new Date().toISOString();
  cachedSystemStatusPayload = Object.freeze({
    connected: true,
    timestamp: sharedTimestamp
  });
  cachedRuntimePongPayload = Object.freeze({
    timestamp: sharedTimestamp
  });
}

function ensureHeartbeatPayloadTimer() {
  if (heartbeatPayloadTimer) return;

  heartbeatPayloadTimer = setInterval(
    refreshHeartbeatPayloads,
    HEARTBEAT_TIMESTAMP_REFRESH_MS
  );

  if (typeof heartbeatPayloadTimer.unref === "function") {
    heartbeatPayloadTimer.unref();
  }
}

function canEmitHeartbeat(socket) {
  if (!socket || !socket.connected) return false;

  const transport = socket.conn?.transport;
  if (transport && transport.writable === false) return false;

  return true;
}

function initializeSocket(io) {
  ioInstance = io;
  ensureHeartbeatPayloadTimer();

  io.on("connection", (socket) => {
    socket.emit("system:status", cachedSystemStatusPayload);

    for (const [event, payload] of latestEvents.entries()) {
      socket.emit(event, payload);
    }

    socket.on("runtime:ping", () => {
      if (!canEmitHeartbeat(socket)) return;

      socket.volatile.emit("runtime:pong", cachedRuntimePongPayload);
    });
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

function emitToAll(event, payload, options = {}) {
  if (!ioInstance) return;

  if (options.cacheLatest) {
    latestEvents.set(event, payload);
  }

  if (ioInstance.engine?.clientsCount === 0) return;

  if (options.volatile) {
    ioInstance.volatile.emit(event, payload);
    return;
  }

  ioInstance.emit(event, payload);
}

module.exports = {
  initializeSocket,
  getIO,
  emitToAll
};
