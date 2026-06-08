let ioInstance = null;
let cachedTimestamp = new Date().toISOString();
let cachedStatusPayload = Object.freeze({ connected: true, timestamp: cachedTimestamp });
let cachedPongPayload = Object.freeze({ timestamp: cachedTimestamp });

setInterval(() => {
  cachedTimestamp = new Date().toISOString();
  cachedStatusPayload = Object.freeze({ connected: true, timestamp: cachedTimestamp });
  cachedPongPayload = Object.freeze({ timestamp: cachedTimestamp });
}, 250).unref();

function initializeSocket(io) {
  ioInstance = io;

  io.on("connection", (socket) => {
    socket.emit("system:status", cachedStatusPayload);

    socket.on("runtime:ping", () => {
      socket.volatile.emit("runtime:pong", cachedPongPayload);
    });
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

function emitToAll(event, payload) {
  const io = ioInstance;
  if (!io || io.engine.clientsCount === 0) return;
  io.emit(event, payload);
}

module.exports = {
  initializeSocket,
  getIO,
  emitToAll
};
