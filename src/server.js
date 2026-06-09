require("dotenv").config();

const engineRunner = require("./services/engine-runner.service");
const marketDataService = require("./services/market-data.service");
const authMiddleware = require("./middlewares/auth.middleware");
const { requirePremium } = require("./middlewares/plan.middleware");
const billingController = require("./controllers/billing.controller");
const signalRepository = require("./repositories/signal.repository");
const createApp = require("./app/create-app");

const { server } = createApp({
  engineRunner,
  marketDataService,
  authMiddleware,
  requirePremium,
  billingController,
  signalRepository,
  corsOrigin: process.env.CORS_ORIGIN
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 AERIX rodando na porta ${PORT}`);

  if (String(process.env.AUTO_START_ENGINE).toLowerCase() === "true") {
    engineRunner.start();
  }
});
