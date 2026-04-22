const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const roleMiddleware = require("../middlewares/role.middleware");
const userController = require("../controllers/user.controller");

const router = express.Router();

/**
 * Rotas autenticadas do próprio usuário
 */
router.get("/me/profile", authMiddleware, userController.getMyProfile);
router.put("/me/profile", authMiddleware, userController.updateMyProfile);

router.get("/me/preferences", authMiddleware, userController.getMyPreferences);
router.put("/me/preferences", authMiddleware, userController.updateMyPreferences);

router.get("/modes", authMiddleware, userController.getModeCatalog);

/**
 * Rotas administrativas
 */
router.get(
  "/",
  authMiddleware,
  roleMiddleware("admin"),
  userController.listUsers
);

router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  userController.getUserById
);

router.patch(
  "/:id/role",
  authMiddleware,
  roleMiddleware("admin"),
  userController.updateUserRole
);

module.exports = router;