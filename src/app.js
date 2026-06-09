const express = require("express");
const cors = require("cors");
const path = require("path");

const apiRoutes = require("./routes");
const productionRoutes = require("./routes/production.routes");
const billingController = require("./controllers/billing.controller");

function createApp() {
  const app = express();

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

  app.use("/api", productionRoutes);

  app.get("/api/health", (req, res) => {
    return res.json({
      ok: true,
      service: "AERIX",
      status: "online",
      timestamp: new Date().toISOString()
    });
  });

  app.use("/api", apiRoutes);

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
  });

  return app;
}

module.exports = createApp;
