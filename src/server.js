const http = require("http");

require("dotenv").config();

const { Server } = require("socket.io");
const createApp = require("./app");
const engineRunner = require("./services/engine-runner.service");
const { initializeSocket } = require("./websocket/socket");
const { bootstrapDatabase } = require("./bootstrap/database-bootstrap");

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*"
  },
  transports: ["websocket", "polling"],
  perMessageDeflate: false,
  httpCompression: false,
  pingInterval: Number(process.env.SOCKET_PING_INTERVAL_MS || 10000),
  pingTimeout: Number(process.env.SOCKET_PING_TIMEOUT_MS || 5000),
  connectionStateRecovery: {
    maxDisconnectionDuration: Number(process.env.SOCKET_RECOVERY_MS || 30000),
    skipMiddlewares: true
  }
});

initializeSocket(io);

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await bootstrapDatabase();
  } catch (error) {
    console.error("❌ Falha ao sincronizar schema do banco antes do startup:", error.message || error);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`🚀 AERIX rodando na porta ${PORT}`);

    if (String(process.env.AUTO_START_ENGINE).toLowerCase() === "true") {
      engineRunner.start();
    }
  });
}

startServer();
