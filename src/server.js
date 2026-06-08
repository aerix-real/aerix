const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

require("dotenv").config();

const engineRunner = require("./services/engine-runner.service");
const marketDataService = require("./services/market-data.service");
const authMiddleware = require("./middlewares/auth.middleware");
const { requirePremium } = require("./middlewares/plan.middleware");
const billingController = require("./controllers/billing.controller");
const signalRepository = require("./repositories/signal.repository");

const { Server } = require("socket.io");
const { initializeSocket, emitToAll } = require("./websocket/socket");

const app = express();
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


function isConfirmedExecutedSignal(signal = {}) {
  if (!signal || typeof signal !== "object") return false;

  const status = String(signal.status || signal.signal_status || "").toLowerCase();
  const result = String(signal.result || "").toLowerCase();
  const direction = String(signal.direction || signal.signal || "").toUpperCase();
  const blocked = Boolean(signal.blocked);

  const confirmedByStatus = ["confirmed", "executed"].includes(status);
  const confirmedByResult = ["win", "loss", "executed", "confirmed"].includes(result);
  const actionableDirection = ["CALL", "PUT"].includes(direction);

  return !blocked && actionableDirection && (confirmedByStatus || confirmedByResult);
}

function filterConfirmedExecutedSignals(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(isConfirmedExecutedSignal);
}

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  billingController.handleWebhook
);

app.use(cors({
  origin: process.env.CORS_ORIGIN || "*"
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "../public")));

try {
  const authRoutes = require("./routes/auth.routes");
  app.use("/api/auth", authRoutes);
} catch (error) {
  console.log("⚠️ Rotas de auth não encontradas:", error.message);
}

app.post(
  "/api/billing/create-checkout",
  authMiddleware,
  billingController.createCheckout
);

app.get(
  "/api/billing/status",
  authMiddleware,
  billingController.status
);

app.get(
  "/api/premium/status",
  authMiddleware,
  billingController.status
);

app.get("/api/dashboard", authMiddleware, requirePremium, (req, res) => {
  try {
    return res.json({
      ok: true,
      data: engineRunner.getState()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar dashboard"
    });
  }
});

app.get("/api/engine", authMiddleware, requirePremium, (req, res) => {
  try {
    return res.json({
      ok: true,
      data: engineRunner.getState()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar engine"
    });
  }
});

app.post("/api/engine/start", authMiddleware, requirePremium, (req, res) => {
  try {
    engineRunner.start();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao iniciar engine"
    });
  }
});

app.post("/api/engine/stop", authMiddleware, requirePremium, (req, res) => {
  try {
    engineRunner.stop();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao parar engine"
    });
  }
});

app.get("/api/market/status", authMiddleware, async (req, res) => {
  try {
    const data = await marketDataService.getMarketStatus();

    return res.json({
      ok: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao obter status do mercado"
    });
  }
});

app.get("/api/signals/recent", authMiddleware, async (req, res) => {
  try {
    const state = typeof engineRunner.getState === "function"
      ? engineRunner.getState()
      : {};

    let signals =
      state.recentSignals ||
      state.history ||
      state.signals ||
      [];

    if (!Array.isArray(signals) || signals.length === 0) {
      signals = await signalRepository.getLatest(50);
    }

    return res.json({
      ok: true,
      signals: filterConfirmedExecutedSignals(signals).slice(0, 50)
    });
  } catch (error) {
    return res.json({
      ok: true,
      signals: []
    });
  }
});

app.post("/api/signals/:id/result", authMiddleware, requirePremium, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = String(req.body?.result || "").trim().toLowerCase();

    if (!id || !["win", "loss"].includes(result)) {
      return res.status(400).json({
        ok: false,
        message: "Resultado invÃ¡lido."
      });
    }

    const saved = await signalRepository.updateSignalResult(id, result);

    if (!saved) {
      return res.status(404).json({
        ok: false,
        message: "Sinal nÃ£o encontrado."
      });
    }

    emitToAll("signal-result-updated", saved);

    return res.json({
      ok: true,
      data: saved
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao atualizar resultado."
    });
  }
});

app.get("/api/stats", authMiddleware, async (req, res) => {
  try {
    const state = typeof engineRunner.getState === "function"
      ? engineRunner.getState()
      : {};

    let history =
      state.recentSignals ||
      state.history ||
      state.signals ||
      [];

    if (!Array.isArray(history) || history.length === 0) {
      history = await signalRepository.getLatest(200);
    }

    const list = Array.isArray(history) ? history : [];

    const total = list.length;
    const wins = list.filter((item) => String(item.result || "").toLowerCase() === "win").length;
    const losses = list.filter((item) => String(item.result || "").toLowerCase() === "loss").length;
    const winrate = wins + losses > 0
      ? Math.round((wins / (wins + losses)) * 100)
      : 0;

    return res.json({
      ok: true,
      stats: {
        total,
        wins,
        losses,
        winrate
      }
    });
  } catch (error) {
    return res.json({
      ok: true,
      stats: {
        total: 0,
        wins: 0,
        losses: 0,
        winrate: 0
      }
    });
  }
});

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    service: "AERIX",
    status: "online",
    timestamp: new Date().toISOString()
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 AERIX rodando na porta ${PORT}`);

  if (String(process.env.AUTO_START_ENGINE).toLowerCase() === "true") {
    engineRunner.start();
  }
});
