const express = require("express");

const authMiddleware = require("../middlewares/auth.middleware");
const { requirePremium } = require("../middlewares/plan.middleware");
const billingController = require("../controllers/billing.controller");
const engineRunner = require("../services/engine-runner.service");
const marketDataService = require("../services/market-data.service");
const signalRepository = require("../repositories/signal.repository");
const { emitToAll } = require("../websocket/socket");

const router = express.Router();

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

router.post(
  "/billing/create-checkout",
  authMiddleware,
  billingController.createCheckout
);

router.get(
  "/billing/status",
  authMiddleware,
  billingController.status
);

router.get(
  "/premium/status",
  authMiddleware,
  billingController.status
);

router.get("/dashboard", authMiddleware, requirePremium, (req, res) => {
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

router.get("/engine", authMiddleware, requirePremium, (req, res) => {
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

router.post("/engine/start", authMiddleware, requirePremium, (req, res) => {
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

router.post("/engine/stop", authMiddleware, requirePremium, (req, res) => {
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

router.get("/market/status", authMiddleware, async (req, res) => {
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

router.get("/signals/recent", authMiddleware, async (req, res) => {
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

router.post("/signals/:id/result", authMiddleware, requirePremium, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = String(req.body?.result || "").trim().toLowerCase();

    if (!id || !["win", "loss"].includes(result)) {
      return res.status(400).json({
        ok: false,
        message: "Resultado inválido."
      });
    }

    const saved = await signalRepository.updateSignalResult(id, result);

    if (!saved) {
      return res.status(404).json({
        ok: false,
        message: "Sinal não encontrado."
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

router.get("/stats", authMiddleware, async (req, res) => {
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

module.exports = router;
