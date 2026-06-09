const express = require("express");

module.exports = () => {
  const router = express.Router();

  router.get("/health", (req, res) => {
    return res.json({
      ok: true,
      service: "AERIX",
      status: "online",
      timestamp: new Date().toISOString()
    });
  });

  return router;
};
