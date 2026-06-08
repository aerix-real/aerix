const express = require("express");

module.exports = ({ authMiddleware, requirePremium, engineRunner }) => {
  const router = express.Router();

  router.get("/", authMiddleware, requirePremium, (req, res) => {
    try {
      return res.json({ ok: true, data: engineRunner.getState() });
    } catch (error) {
      return res.status(500).json({ ok: false, message: "Erro ao carregar engine" });
    }
  });

  router.post("/start", authMiddleware, requirePremium, (req, res) => {
    try {
      engineRunner.start();
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, message: "Erro ao iniciar engine" });
    }
  });

  router.post("/stop", authMiddleware, requirePremium, (req, res) => {
    try {
      engineRunner.stop();
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, message: "Erro ao parar engine" });
    }
  });

  return router;
};
