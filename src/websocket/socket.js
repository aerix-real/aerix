let ioInstance = null;

function initializeSocket(io) {
  ioInstance = io;

  io.on("connection", (socket) => {
    socket.emit("system:status", {
      connected: true,
      timestamp: new Date().toISOString()
    });

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

function emitToAll(event, payload) {
  if (!ioInstance) return;
  ioInstance.emit(event, payload);
}

module.exports = {
  initializeSocket,
  getIO,
  emitToAll
};