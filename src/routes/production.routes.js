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

function normalizePositiveInteger(value, fallback, max = 200) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(num)));
}

function normalizeOffset(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.trunc(num));
}

function normalizeOptionalFilter(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeModeAliases(value) {
  const mode = normalizeOptionalFilter(value)?.toLowerCase();

  if (["conservador", "conservative"].includes(mode)) return ["conservador", "conservative"];
  if (["agressivo", "aggressive"].includes(mode)) return ["agressivo", "aggressive"];
  if (["equilibrado", "balanced", "balanceado"].includes(mode)) return ["equilibrado", "balanced", "balanceado"];

  return mode ? [mode] : [];
}

function filterStateSignals(signals = [], filters = {}) {
  const direction = normalizeOptionalFilter(filters.direction || filters.signal)?.toUpperCase();
  const result = normalizeOptionalFilter(filters.result)?.toLowerCase();
  const modeAliases = normalizeModeAliases(filters.mode);
  const symbol = normalizeOptionalFilter(filters.symbol || filters.asset)?.toLowerCase();

  return filterConfirmedOperationalSignals(signals).filter((signal) => {
    const signalDirection = String(signal.signal || signal.direction || signal.action || "").toUpperCase();
    const signalResult = String(signal.result || "pending").toLowerCase();
    const signalMode = String(signal.mode || "").toLowerCase();
    const signalSymbol = String(signal.symbol || signal.asset || "").toLowerCase();

    return (!direction || signalDirection === direction)
      && (!result || signalResult === result)
      && (!modeAliases.length || modeAliases.includes(signalMode))
      && (!symbol || signalSymbol.includes(symbol));
  });
}

router.get("/signals/recent", authMiddleware, async (req, res) => {
  const limit = normalizePositiveInteger(req.query.limit, 20, 50);
  const page = normalizePositiveInteger(req.query.page, 1, 10000);
  const offset = normalizeOffset(req.query.offset, (page - 1) * limit);
  const filters = {
    direction: normalizeOptionalFilter(req.query.direction || req.query.signal),
    result: normalizeOptionalFilter(req.query.result),
    mode: normalizeOptionalFilter(req.query.mode),
    symbol: normalizeOptionalFilter(req.query.symbol || req.query.asset)
  };

  try {
    const history = typeof signalRepository.getConfirmedHistory === "function"
      ? await signalRepository.getConfirmedHistory({ limit, offset, ...filters })
      : { rows: await signalRepository.getLatestConfirmed(limit, filters), total: 0, limit, offset };

    return res.json({
      ok: true,
      signals: filterConfirmedOperationalSignals(history.rows).slice(0, limit),
      pagination: {
        limit: history.limit || limit,
        offset: history.offset || offset,
        page: Math.floor((history.offset || offset) / (history.limit || limit)) + 1,
        total: history.total || 0,
        hasMore: (history.offset || offset) + (history.rows?.length || 0) < (history.total || 0)
      },
      filters
    });
  } catch (error) {
    try {
      const state = typeof engineRunner.getState === "function"
        ? engineRunner.getState()
        : {};

      const stateSignals = state.recentSignals || state.history || state.signals || state.latestResults || [];
      const filtered = filterStateSignals(Array.isArray(stateSignals) ? stateSignals : [], filters);

      return res.json({
        ok: true,
        signals: filtered.slice(offset, offset + limit),
        pagination: {
          limit,
          offset,
          page,
          total: filtered.length,
          hasMore: offset + limit < filtered.length
        },
        filters
      });
    } catch (fallbackError) {
      return res.json({
        ok: true,
        signals: [],
        pagination: { limit, offset, page, total: 0, hasMore: false },
        filters
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
