const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const { initializeSocket } = require("../websocket/socket");
const createApiRouter = require("../routes");

module.exports = ({
  engineRunner,
  marketDataService,
  authMiddleware,
  requirePremium,
  billingController,
  corsOrigin
}) => {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, { cors: { origin: corsOrigin || "*" } });
  initializeSocket(io);

  app.use(cors({ origin: corsOrigin || "*" }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, "../../public")));

  app.use(
    "/api",
    createApiRouter({
      engineRunner,
      marketDataService,
      authMiddleware,
      requirePremium,
      billingController
    })
  );

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../../public/index.html"));
  });

  return { app, server };
};
