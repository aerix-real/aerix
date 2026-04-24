const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const db = require("./config/database");
const routes = require("./routes");
const billingController = require("./controllers/billing.controller");
const { initializeSocket } = require("./websocket/socket");
const engineRunnerService = require("./services/engine-runner.service");
const authService = require("./services/auth.service");
const runtimeConfig = require("./config/runtime");
const { bootstrapDatabase } = require("./bootstrap/database-bootstrap");

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
    allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"]
  })
);

/**
 * Stripe webhook precisa do corpo bruto.
 * Precisa vir antes do express.json().
 */
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  billingController.handleWebhook
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.static(PUBLIC_DIR));

/**
 * =========================================================
 * ROTAS PÚBLICAS DO PAINEL
 * =========================================================
 * Essas rotas ficam ANTES de app.use("/api", routes)
 * para evitar que o painel fique travado por 401.
 */

app.get("/api/status", (req, res) => {
  const state = engineRunnerService.getState();

  return res.status(200).json({
    ok: true,
    marketStatus: state.isRunning ? "open" : "monitorando",
    systemStatus: state.isRunning ? "Online" : "Standby",
    engineRunning: state.isRunning,
    isProcessing: state.isProcessing,
    bestOpportunity: state.bestOpportunity,
    latestResults: state.latestResults,
    rateLimit: state.rateLimit,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/panel", (req, res) => {
  const state = engineRunnerService.getState();

  return res.status(200).json({
    ok: true,
    marketStatus: state.isRunning ? "open" : "monitorando",
    systemStatus: state.isRunning ? "Online" : "Standby",
    signal: state.bestOpportunity || null,
    currentSignal: state.bestOpportunity || null,
    history: state.latestResults || [],
    signals: state.latestResults || [],
    ranking: state.latestResults || [],
    stats: {
      signalsToday: Array.isArray(state.latestResults) ? state.latestResults.length : 0,
      wins: state.historyStats?.wins || 0,
      losses: state.historyStats?.losses || 0,
      winRate: state.historyStats?.avgConfidence || 0
    },
    radar: {
      opportunities: Array.isArray(state.latestResults) ? state.latestResults.length : 0,
      avgQuality:
        Array.isArray(state.latestResults) && state.latestResults.length
          ? state.latestResults.reduce(
              (sum, item) =>
                sum + Number(item.adjustedScore ?? item.finalScore ?? item.confidence ?? 0),
              0
            ) / state.latestResults.length
          : 0
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/api/signals", (req, res) => {
  const state = engineRunnerService.getState();

  return res.status(200).json({
    ok: true,
    data: state.latestResults || [],
    signals: state.latestResults || [],
    bestOpportunity: state.bestOpportunity || null,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/dashboard", (req, res) => {
  const state = engineRunnerService.getState();

  return res.status(200).json({
    ok: true,
    data: {
      connection: {
        engineRunning: state.isRunning,
        isProcessing: state.isProcessing,
        lastCycleAt: new Date().toISOString()
      },
      signalCenter: {
        bestOpportunity: state.bestOpportunity || null
      },
      ranking: state.latestResults || [],
      history: state.latestResults || [],
      analytics: {
        historyStats: state.historyStats || {}
      },
      rateLimit: state.rateLimit,
      trackedSymbols: state.trackedSymbols || []
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * Rotas principais do sistema.
 * Auth, users, premium, billing, engine, runtime etc continuam aqui.
 */
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

/**
 * Fallback para SPA/painel.
 */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({
      ok: false,
      message: "Rota de API não encontrada"
    });
  }

  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("Erro global:", err);

  return res.status(err.statusCode || 500).json({
    ok: false,
    message: err.message || "Erro interno do servidor"
  });
});

server.listen(PORT, HOST, async () => {
  console.log("=================================");
  console.log("🚀 AERIX INICIADA");
  console.log("=================================");
  console.log(`🌐 Painel: http://localhost:${PORT}`);
  console.log(`❤️ Health: http://localhost:${PORT}/health`);
  console.log(`🔐 API Auth: http://localhost:${PORT}/api/auth`);
  console.log(`📊 Dashboard público: http://localhost:${PORT}/api/dashboard`);
  console.log(`📡 Status público: http://localhost:${PORT}/api/status`);
  console.log(`🧠 Engine: http://localhost:${PORT}/api/engine`);
  console.log(`⚙ Runtime: http://localhost:${PORT}/api/runtime`);
  console.log(`💳 Billing: http://localhost:${PORT}/api/billing/status`);
  console.log("=================================");

  try {
    const dbInfo = await db.query(`
      SELECT
        current_database() AS current_database,
        inet_server_addr() AS inet_server_addr,
        inet_server_port() AS inet_server_port,
        current_schema() AS current_schema
    `);

    console.log("BANCO USADO PELO NODE:", dbInfo.rows[0]);
  } catch (error) {
    console.error("ERRO AO INSPECIONAR BANCO NO NODE:", error.message || error);
  }

  try {
    await bootstrapDatabase();
  } catch (error) {
    console.error("❌ Erro no bootstrap do banco:", error.message || error);
  }

  try {
    const bootstrap = await authService.bootstrapAdmin();

    if (bootstrap?.created) {
      console.log("👑 Admin bootstrap criado com sucesso.");
      console.log(`📧 Admin: ${bootstrap.user.email}`);
    } else {
      console.log("👑 Admin já existe no banco.");
    }
  } catch (error) {
    console.error("❌ Erro ao criar admin inicial:", error.message || error);
  }

  if (runtimeConfig.AUTO_START_ENGINE) {
    engineRunnerService.start();
    console.log("▶ Engine auto-start ativada.");
  }
});