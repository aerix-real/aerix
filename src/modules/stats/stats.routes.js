const express = require("express");

module.exports = ({ authMiddleware, engineRunner }) => {
  const router = express.Router();

  router.get("/", authMiddleware, async (req, res) => {
    try {
      const state = typeof engineRunner.getState === "function" ? engineRunner.getState() : {};
      const history = state.recentSignals || state.history || state.signals || [];
      const list = Array.isArray(history) ? history : [];
      const total = list.length;
      const wins = list.filter((item) => item.result === "WIN").length;
      const losses = list.filter((item) => item.result === "LOSS").length;
      const winrate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

      return res.json({ ok: true, stats: { total, wins, losses, winrate } });
    } catch (error) {
      return res.json({ ok: true, stats: { total: 0, wins: 0, losses: 0, winrate: 0 } });
    }
  });

  return router;
};
