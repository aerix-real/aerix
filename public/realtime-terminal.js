(function exposeRealtimeTerminal(global) {
  class RealtimeTerminalClient {
    constructor(socket, { poll, pollingMs = 15000 } = {}) {
      this.socket = socket;
      this.poll = poll;
      this.pollingMs = pollingMs;
      this.seen = new Set();
      this.serverOffsetMs = 0;
      this.liveState = null;
      this.heartbeatStatus = "connecting";
      this.pollTimer = null;
      this.handlers = new Map();
      this.bindCoreEvents();
    }

    bindCoreEvents() {
      this.socket.on("connect", () => {
        this.heartbeatStatus = "online";
        this.stopFallbackPolling();
      });
      this.socket.on("disconnect", () => {
        this.heartbeatStatus = "reconnecting";
        this.startFallbackPolling();
      });
      this.on("system:heartbeat", (data) => {
        this.heartbeatStatus = data.status || "online";
      });
      this.on("terminal:snapshot", (data) => {
        this.liveState = data.liveState || data;
      });
    }

    on(event, handler) {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
        this.socket.on(event, (envelope) => this.dispatch(event, envelope));
      }
      this.handlers.get(event).push(handler);
    }

    dispatch(event, envelope = {}) {
      if (envelope.eventId) {
        if (this.seen.has(envelope.eventId)) return;
        this.seen.add(envelope.eventId);
        if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
      }
      const serverTime = Date.parse(envelope.serverTimestamp);
      if (Number.isFinite(serverTime)) this.serverOffsetMs = serverTime - Date.now();
      const data = Object.prototype.hasOwnProperty.call(envelope, "data") ? envelope.data : envelope;
      for (const handler of this.handlers.get(event) || []) handler(data, envelope);
    }

    startFallbackPolling() {
      if (this.pollTimer || typeof this.poll !== "function") return;
      const run = async () => {
        try { await this.poll(); } finally {
          if (!this.socket.connected) this.pollTimer = setTimeout(run, this.pollingMs);
          else this.pollTimer = null;
        }
      };
      this.pollTimer = setTimeout(run, this.pollingMs);
    }

    stopFallbackPolling() {
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  global.RealtimeTerminalClient = RealtimeTerminalClient;
}(window));
