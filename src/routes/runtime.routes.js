const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");
const runtimeController = require("../controllers/runtime.controller");

const router = express.Router();

router.get(
  "/state",
  authMiddleware,
  roleMiddleware("admin"),
  runtimeController.getRuntimeState
);

router.post(
  "/start",
  authMiddleware,
  roleMiddleware("admin"),
  runtimeController.startEngine
);

router.post(
  "/stop",
  authMiddleware,
  roleMiddleware("admin"),
  runtimeController.stopEngine
);

router.post(
  "/run-now",
  authMiddleware,
  roleMiddleware("admin"),
  runtimeController.runCycleNow
);

module.exports = router;