const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const routes = require("./routes");
const { initializeSocket } = require("./websocket/socket");
const engineRunnerService = require("./services/engine-runner.service");
const runtimeConfig = require("./config/runtime");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
  }
});

initializeSocket(io);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.static(PUBLIC_DIR));
app.use("/api", routes);

app.get("/health", (req, res) => {
  return res.status(200).json({
    ok: true,
    service: "AERIX",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("Erro global:", err);

  return res.status(err.statusCode || 500).json({
    ok: false,
    message: err.message || "Erro interno do servidor"
  });
});

server.listen(PORT, HOST, () => {
  console.log("=================================");
  console.log("🚀 AERIX INICIADA");
  console.log("=================================");
  console.log(`🌐 Painel: http://localhost:${PORT}`);
  console.log(`❤️ Health: http://localhost:${PORT}/health`);
  console.log(`🔐 API Auth: http://localhost:${PORT}/api/auth`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/api/dashboard`);
  console.log(`🧠 Engine: http://localhost:${PORT}/api/engine`);
  console.log(`⚙ Runtime: http://localhost:${PORT}/api/runtime`);
  console.log("=================================");

  if (runtimeConfig.AUTO_START_ENGINE) {
    engineRunnerService.start();
    console.log("▶ Engine auto-start ativada.");
  }
});