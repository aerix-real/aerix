const crypto = require("crypto");

const DEFAULT_HEARTBEAT_MS = 10000;

class RealtimeTerminalService {
  constructor() {
    this.io = null;
    this.sequenceNumber = 0;
    this.heartbeatTimer = null;
    this.snapshotProvider = async () => ({});
    this.latestByEvent = new Map();
  }

  configure(io, { snapshotProvider, heartbeatMs } = {}) {
    if (this.io === io) return this;
    this.stop();
    this.io = io;
    if (typeof snapshotProvider === "function") this.snapshotProvider = snapshotProvider;

    io.on("connection", async (socket) => {
      socket.emit("system:heartbeat", this.envelope("system:heartbeat", { status: "online" }));
      try {
        socket.emit("terminal:snapshot", this.envelope("terminal:snapshot", await this.snapshotProvider()));
      } catch (error) {
        console.error("Erro ao gerar terminal snapshot:", error.message || error);
      }
    });

    const interval = Math.max(1000, Number(heartbeatMs || process.env.SOCKET_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS));
    this.heartbeatTimer = setInterval(() => this.broadcast("system:heartbeat", { status: "online" }, { volatile: true }), interval);
    this.heartbeatTimer.unref?.();
    return this;
  }

  envelope(event, data) {
    const serverTimestamp = new Date().toISOString();
    const sequenceNumber = ++this.sequenceNumber;
    return Object.freeze({
      eventId: crypto.randomUUID(),
      sequenceNumber,
      serverTimestamp,
      event,
      data
    });
  }

  broadcast(event, data, { cacheLatest = false, volatile = false } = {}) {
    const payload = this.envelope(event, data);
    if (cacheLatest) this.latestByEvent.set(event, payload);
    if (!this.io || this.io.engine?.clientsCount === 0) return payload;
    (volatile ? this.io.volatile : this.io).emit(event, payload);
    return payload;
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.io = null;
  }
}

module.exports = new RealtimeTerminalService();
