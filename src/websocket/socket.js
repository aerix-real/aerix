let ioInstance = null;
const latestEvents = new Map();

function initializeSocket(io) {
  ioInstance = io;

  io.on("connection", (socket) => {
    socket.emit("system:status", {
      connected: true,
      timestamp: new Date().toISOString()
    });

    for (const [event, payload] of latestEvents.entries()) {
      socket.emit(event, payload);
    }

    socket.on("runtime:ping", () => {
      socket.emit("runtime:pong", {
        timestamp: new Date().toISOString()
      });
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
