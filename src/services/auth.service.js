const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../config/database");

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "aerix_access_secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "aerix_refresh_secret";

const ACCESS_EXPIRES = "15m";
const REFRESH_EXPIRES = "7d";

function resolveUserPlan(user) {
  const role = String(user?.role || "").toLowerCase();
  const plan = String(user?.plan || "").toLowerCase();

  if (role === "admin") return "premium";
  if (plan === "premium") return "premium";

  return "free";
}

function buildUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || "user",
    plan: resolveUserPlan(user)
  };
}

function generateAccessToken(user) {
  const payload = buildUserPayload(user);

  return jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      plan: payload.plan
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function saveRefreshToken(userId, token) {
  await db.query(
    `
    INSERT INTO user_sessions (user_id, refresh_token)
    VALUES ($1, $2)
    `,
    [userId, token]
  );
}

async function deleteRefreshToken(token) {
  await db.query(
    `
    DELETE FROM user_sessions
    WHERE refresh_token = $1
    `,
    [token]
  );
}

async function register({ name, email, password }) {
  const safeName = String(name || "").trim();
  const safeEmail = String(email || "").trim().toLowerCase();
  const safePassword = String(password || "").trim();

  if (!safeName || !safeEmail || !safePassword) {
    throw { statusCode: 400, message: "Dados inválidos." };
  }

  if (safePassword.length < 6) {
    throw { statusCode: 400, message: "A senha deve ter pelo menos 6 caracteres." };
  }

  const existing = await db.query(
    `
    SELECT id
    FROM users
    WHERE email = $1
    `,
    [safeEmail]
  );

  if (existing.rows.length > 0) {
    throw { statusCode: 400, message: "Email já está em uso." };
  }

  const passwordHash = await hashPassword(safePassword);

  const result = await db.query(
    `
    INSERT INTO users (name, email, password_hash, role, plan)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, role, plan
    `,
    [safeName, safeEmail, passwordHash, "user", "free"]
  );

  const user = buildUserPayload(result.rows[0]);
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await saveRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
}

async function login({ email, password }) {
  const safeEmail = String(email || "").trim().toLowerCase();
  const safePassword = String(password || "").trim();

  if (!safeEmail || !safePassword) {
    throw { statusCode: 401, message: "Credenciais inválidas." };
  }

  const result = await db.query(
    `
    SELECT id, name, email, password_hash, role, plan, created_at
    FROM users
    WHERE email = $1
    `,
    [safeEmail]
  );

  if (result.rows.length === 0) {
    throw { statusCode: 401, message: "Credenciais inválidas." };
  }

  const userRow = result.rows[0];
  const valid = await comparePassword(safePassword, userRow.password_hash);

  if (!valid) {
    throw { statusCode: 401, message: "Credenciais inválidas." };
  }

  const user = buildUserPayload(userRow);
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await saveRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
}

async function getUserById(id) {
  const result = await db.query(
    `
    SELECT id, name, email, role, plan, created_at
    FROM users
    WHERE id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    throw { statusCode: 404, message: "Usuário não encontrado." };
  }

  return buildUserPayload(result.rows[0]);
}

async function refreshSession(refreshToken) {
  if (!refreshToken) {
    throw { statusCode: 401, message: "Refresh token inválido." };
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);

    const session = await db.query(
      `
      SELECT id, user_id, refresh_token, created_at
      FROM user_sessions
      WHERE refresh_token = $1
      `,
      [refreshToken]
    );

    if (session.rows.length === 0) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const user = await getUserById(decoded.id);
    const newAccess = generateAccessToken(user);
    const newRefresh = generateRefreshToken(user);

    await deleteRefreshToken(refreshToken);
    await saveRefreshToken(user.id, newRefresh);

    return {
      user,
      accessToken: newAccess,
      refreshToken: newRefresh
    };
  } catch (_) {
    throw { statusCode: 401, message: "Refresh token inválido." };
  }
}

async function logout(refreshToken) {
  if (!refreshToken) return true;

  await deleteRefreshToken(refreshToken);
  return true;
}

async function bootstrapAdmin() {
  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@aerix.com")
    .trim()
    .toLowerCase();

  const adminPassword = String(process.env.ADMIN_PASSWORD || "123456").trim();

  const existing = await db.query(
    `
    SELECT id, name, email, role, plan
    FROM users
    WHERE email = $1
    `,
    [adminEmail]
  );

  if (existing.rows.length > 0) {
    return {
      created: false,
      user: buildUserPayload(existing.rows[0])
    };
  }

  const passwordHash = await hashPassword(adminPassword);

  const result = await db.query(
    `
    INSERT INTO users (name, email, password_hash, role, plan)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, role, plan
    `,
    ["Administrador", adminEmail, passwordHash, "admin", "premium"]
  );

  return {
    created: true,
    user: buildUserPayload(result.rows[0])
  };
}

async function verifyAccessToken(token) {
  try {
    return jwt.verify(token, ACCESS_SECRET);
  } catch (_) {
    throw { statusCode: 401, message: "Token inválido ou expirado." };
  }
}

module.exports = {
  register,
  login,
  getUserById,
  refreshSession,
  logout,
  bootstrapAdmin,
  verifyAccessToken
};