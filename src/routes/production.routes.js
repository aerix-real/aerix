const express = require("express");

const authMiddleware = require("../middlewares/auth.middleware");
const billingController = require("../controllers/billing.controller");
const engineRunner = require("../services/engine-runner.service");
const marketDataService = require("../services/market-data.service");
const signalRepository = require("../repositories/signal.repository");
const { emitToAll } = require("../websocket/socket");
const {
  isConfirmedOperationalSignal,
  filterConfirmedOperationalSignals
} = require("../utils/signal-history-filter");

const router = express.Router();

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

router.get("/dashboard", authMiddleware, (req, res) => {
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

router.get("/engine", authMiddleware, (req, res) => {
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

router.post("/engine/start", authMiddleware, (req, res) => {
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

router.post("/engine/stop", authMiddleware, (req, res) => {
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
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);
    const filters = {
      symbol: String(req.query.symbol || "").trim(),
      strategy: String(req.query.strategy || "").trim(),
      result: String(req.query.result || "").trim().toLowerCase()
    };

    const [history, filterOptions] = await Promise.all([
      signalRepository.getSignalHistory({ page, limit, ...filters }),
      signalRepository.getSignalHistoryFilterOptions()
    ]);

    return res.json({
      ok: true,
      signals: history.items,
      data: history.items,
      pagination: history.pagination,
      filters: filterOptions
    });
  } catch (error) {
    try {
      const state = typeof engineRunner.getState === "function"
        ? engineRunner.getState()
        : {};

      let signals =
        state.recentSignals ||
        state.history ||
        state.signals ||
        state.latestResults ||
        [];

      if (!Array.isArray(signals) || signals.length === 0) {
        signals = await signalRepository.getLatestConfirmed(200);
      }

      const filteredSignals = filterConfirmedOperationalSignals(signals).slice(0, 50);

      return res.json({
        ok: true,
        signals: filteredSignals,
        data: filteredSignals,
        pagination: {
          page: 1,
          limit: filteredSignals.length,
          total: filteredSignals.length,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false
        },
        filters: { symbols: [], strategies: [], results: [] }
      });
    } catch (fallbackError) {
      return res.json({
        ok: true,
        signals: [],
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
        filters: { symbols: [], strategies: [], results: [] }
      });
    }
  }
});

router.post("/signals/:id/result", authMiddleware, async (req, res) => {
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

    if (isConfirmedOperationalSignal(saved)) {
      emitToAll("signal-result-updated", saved);
    }

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
      state.latestResults ||
      [];

    if (!Array.isArray(history) || history.length === 0) {
      history = await signalRepository.getLatestConfirmed(200);
    }

    const list = filterConfirmedOperationalSignals(history);

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
