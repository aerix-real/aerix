const express = require("express");

module.exports = ({ authMiddleware, marketDataService }) => {
  const router = express.Router();

  router.get("/status", authMiddleware, async (req, res) => {
    try {
      const data = await marketDataService.getMarketStatus();
      return res.json({ ok: true, data });
    } catch (error) {
      return res.status(500).json({ ok: false, message: "Erro ao obter status do mercado" });
    }
  });

  return router;
};
