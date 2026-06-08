const express = require("express");

module.exports = ({ authMiddleware, requirePremium, engineRunner }) => {
  const router = express.Router();

  router.get("/", authMiddleware, requirePremium, (req, res) => {
    try {
      return res.json({ ok: true, data: engineRunner.getState() });
    } catch (error) {
      return res.status(500).json({ ok: false, message: "Erro ao carregar dashboard" });
    }
  });

  return router;
};
