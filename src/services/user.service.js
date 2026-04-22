const userRepository = require("../repositories/user.repository");
const userPreferencesRepository = require("../repositories/user-preferences.repository");
const { getTradingMode, listTradingModes } = require("../config/trading-modes");

const ALLOWED_ROLES = ["user", "admin"];
const ALLOWED_MODES = ["conservative", "balanced", "aggressive"];
const ALLOWED_THEMES = ["dark", "light"];
const ALLOWED_LAYOUTS = ["default", "focus", "compact"];

function normalizeSymbols(symbols) {
  if (!Array.isArray(symbols)) return [];

  return symbols
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);
}

async function ensurePreferences(userId) {
  let preferences = await userPreferencesRepository.findByUserId(userId);

  if (!preferences) {
    preferences = await userPreferencesRepository.createDefault(userId);
  }

  return preferences;
}

async function getMyProfile(userId) {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw {
      statusCode: 404,
      message: "Usuário não encontrado."
    };
  }

  return user;
}

async function updateMyProfile(userId, { name, email }) {
  const currentUser = await userRepository.findById(userId);

  if (!currentUser) {
    throw {
      statusCode: 404,
      message: "Usuário não encontrado."
    };
  }

  const finalName = String(name || "").trim();
  const finalEmail = String(email || "").trim().toLowerCase();

  if (!finalName) {
    throw {
      statusCode: 400,
      message: "Nome é obrigatório."
    };
  }

  if (!finalEmail) {
    throw {
      statusCode: 400,
      message: "Email é obrigatório."
    };
  }

  const emailOwner = await userRepository.findByEmail(finalEmail);

  if (emailOwner && emailOwner.id !== userId) {
    throw {
      statusCode: 400,
      message: "Este email já está sendo usado por outro usuário."
    };
  }

  const updatedUser = await userRepository.updateProfile(userId, {
    name: finalName,
    email: finalEmail
  });

  return updatedUser;
}

async function getMyPreferences(userId) {
  const preferences = await ensurePreferences(userId);
  const modeConfig = getTradingMode(preferences.trading_mode);

  return {
    ...preferences,
    mode_config: modeConfig
  };
}

async function updateMyPreferences(userId, payload = {}) {
  const current = await ensurePreferences(userId);

  const tradingMode = payload.trading_mode || current.trading_mode;
  const panelLayout = payload.panel_layout || current.panel_layout;
  const theme = payload.theme || current.theme;

  if (!ALLOWED_MODES.includes(tradingMode)) {
    throw {
      statusCode: 400,
      message: "Modo operacional inválido."
    };
  }

  if (!ALLOWED_LAYOUTS.includes(panelLayout)) {
    throw {
      statusCode: 400,
      message: "Layout inválido."
    };
  }

  if (!ALLOWED_THEMES.includes(theme)) {
    throw {
      statusCode: 400,
      message: "Tema inválido."
    };
  }

  const nextPreferences = {
    trading_mode: tradingMode,
    preferred_symbols: normalizeSymbols(
      payload.preferred_symbols ?? current.preferred_symbols
    ),
    ai_explanations_enabled:
      typeof payload.ai_explanations_enabled === "boolean"
        ? payload.ai_explanations_enabled
        : current.ai_explanations_enabled,
    notifications_enabled:
      typeof payload.notifications_enabled === "boolean"
        ? payload.notifications_enabled
        : current.notifications_enabled,
    panel_layout: panelLayout,
    theme
  };

  const saved = await userPreferencesRepository.upsertByUserId(
    userId,
    nextPreferences
  );

  return {
    ...saved,
    mode_config: getTradingMode(saved.trading_mode)
  };
}

async function getModeCatalog() {
  return listTradingModes();
}

async function listUsers() {
  return userRepository.listAll();
}

async function getUserById(userId) {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw {
      statusCode: 404,
      message: "Usuário não encontrado."
    };
  }

  const preferences = await ensurePreferences(userId);

  return {
    ...user,
    preferences
  };
}

async function updateUserRole(targetUserId, role) {
  if (!ALLOWED_ROLES.includes(role)) {
    throw {
      statusCode: 400,
      message: "Role inválida."
    };
  }

  const updated = await userRepository.updateRole(targetUserId, role);

  if (!updated) {
    throw {
      statusCode: 404,
      message: "Usuário não encontrado."
    };
  }

  return updated;
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