const express = require("express");

module.exports = ({ authMiddleware, engineRunner }) => {
  const router = express.Router();

  router.get("/recent", authMiddleware, async (req, res) => {
    try {
      const state = typeof engineRunner.getState === "function" ? engineRunner.getState() : {};
      const signals = state.recentSignals || state.history || state.signals || [];
      return res.json({ ok: true, signals: Array.isArray(signals) ? signals.slice(0, 50) : [] });
    } catch (error) {
      return res.json({ ok: true, signals: [] });
    }
  });

  return router;
};
