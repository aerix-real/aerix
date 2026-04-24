const userService = require("../services/user.service");

async function getMyProfile(req, res) {
  try {
    const user = await userService.getMyProfile(req.user.id);

    return res.status(200).json({
      ok: true,
      data: user
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao buscar perfil."
    });
  }
}

async function updateMyProfile(req, res) {
  try {
    const user = await userService.updateMyProfile(req.user.id, req.body);

    return res.status(200).json({
      ok: true,
      message: "Perfil atualizado com sucesso.",
      data: user
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao atualizar perfil."
    });
  }
}

async function getMyPreferences(req, res) {
  try {
    let preferences = await userService.getMyPreferences(req.user.id);

    if (!preferences) {
      preferences = {
        trading_mode: "balanced",
        preferred_symbols: [],
        ai_explanations_enabled: true,
        notifications_enabled: true,
        panel_layout: "default",
        theme: "dark"
      };
    }

    return res.status(200).json({
      ok: true,
      data: preferences
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao buscar preferências."
    });
  }
}

async function updateMyPreferences(req, res) {
  try {
    const preferences = await userService.updateMyPreferences(
      req.user.id,
      req.body
    );

    return res.status(200).json({
      ok: true,
      message: "Preferências atualizadas com sucesso.",
      data: preferences
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao atualizar preferências."
    });
  }
}

async function getModeCatalog(req, res) {
  try {
    const modes = await userService.getModeCatalog();

    return res.status(200).json({
      ok: true,
      data: modes
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao buscar catálogo de modos."
    });
  }
}

async function listUsers(req, res) {
  try {
    const users = await userService.listUsers();

    return res.status(200).json({
      ok: true,
      data: users
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao listar usuários."
    });
  }
}

async function getUserById(req, res) {
  try {
    const user = await userService.getUserById(Number(req.params.id));

    return res.status(200).json({
      ok: true,
      data: user
    });
  } catch (error) {
    return res.status(error.statusCode || 404).json({
      ok: false,
      message: error.message || "Usuário não encontrado."
    });
  }
}

async function updateUserRole(req, res) {
  try {
    const { role } = req.body;

    const user = await userService.updateUserRole(
      Number(req.params.id),
      role
    );

    return res.status(200).json({
      ok: true,
      message: "Role atualizada com sucesso.",
      data: user
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao atualizar role."
    });
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  getMyPreferences,
  updateMyPreferences,
  getModeCatalog,
  listUsers,
  getUserById,
  updateUserRole
};