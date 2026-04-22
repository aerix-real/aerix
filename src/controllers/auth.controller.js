const authService = require("../services/auth.service");

async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    const result = await authService.register({
      name,
      email,
      password
    });

    return res.status(201).json({
      ok: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao criar usuário."
    });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    const result = await authService.login({
      email,
      password
    });

    return res.status(200).json({
      ok: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      ok: false,
      message: error.message || "Credenciais inválidas."
    });
  }
}

async function me(req, res) {
  try {
    const userId = req.user?.id;
    const user = await authService.getUserById(userId);

    return res.status(200).json({
      ok: true,
      user,
      data: {
        user
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 404).json({
      ok: false,
      message: error.message || "Usuário não encontrado."
    });
  }
}

async function refresh(req, res) {
  try {
    const refreshToken =
      req.body.refreshToken ||
      req.headers["x-refresh-token"] ||
      null;

    if (!refreshToken) {
      return res.status(400).json({
        ok: false,
        message: "Refresh token não informado."
      });
    }

    const result = await authService.refreshSession(refreshToken);

    return res.status(200).json({
      ok: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      ok: false,
      message: error.message || "Refresh token inválido."
    });
  }
}

async function logout(req, res) {
  try {
    const refreshToken =
      req.body.refreshToken ||
      req.headers["x-refresh-token"] ||
      null;

    await authService.logout(refreshToken);

    return res.status(200).json({
      ok: true,
      message: "Logout realizado com sucesso."
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao fazer logout."
    });
  }
}

async function bootstrapAdmin(req, res) {
  try {
    const result = await authService.bootstrapAdmin();

    return res.status(200).json({
      ok: true,
      data: result
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "Erro ao inicializar administrador."
    });
  }
}

module.exports = {
  register,
  login,
  me,
  refresh,
  logout,
  bootstrapAdmin
};