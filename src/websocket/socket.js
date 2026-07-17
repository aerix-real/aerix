let ioInstance = null;
const latestEvents = new Map();
const realtimeTerminalService = require("../services/realtime-terminal.service");

function canEmitHeartbeat(socket) {
  if (!socket || !socket.connected) return false;

  const transport = socket.conn?.transport;
  if (transport && transport.writable === false) return false;

  return true;
}

function initializeSocket(io, options = {}) {
  ioInstance = io;

  io.on("connection", (socket) => {
    socket.emit("system:status", { connected: true, timestamp: new Date().toISOString() });

    for (const [event, payload] of latestEvents.entries()) {
      socket.emit(event, payload);
    }

    socket.on("runtime:ping", () => {
      if (!canEmitHeartbeat(socket)) return;

      socket.volatile.emit("runtime:pong", { timestamp: new Date().toISOString() });
    });
  });

  realtimeTerminalService.configure(io, options);

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

function emitRealtime(event, payload, options = {}) {
  return realtimeTerminalService.broadcast(event, payload, options);
}

module.exports = {
  initializeSocket,
  getIO,
  emitToAll,
  emitRealtime
};
