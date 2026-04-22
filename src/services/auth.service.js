const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../config/database");

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const ACCESS_EXPIRES = "15m";
const REFRESH_EXPIRES = "7d";

function buildUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan:
      user.plan ||
      (String(user.role).toLowerCase() === "admin" ? "premium" : "free")
  };
}

function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan || "free"
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    {
      id: user.id
    },
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

// 🔥 NOVO: salvar refresh token
async function saveRefreshToken(userId, token) {
  await db.query(
    `
    INSERT INTO user_sessions (user_id, refresh_token)
    VALUES ($1, $2)
    `,
    [userId, token]
  );
}

async function register({ name, email, password }) {
  if (!name || !email || !password) {
    throw { statusCode: 400, message: "Dados inválidos." };
  }

  const existing = await db.query(
    "SELECT id FROM users WHERE email = $1",
    [email]
  );

  if (existing.rows.length > 0) {
    throw {
      statusCode: 400,
      message: "Email já está em uso."
    };
  }

  const passwordHash = await hashPassword(password);

  const result = await db.query(
    `
    INSERT INTO users (name, email, password_hash, role)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, email, role
    `,
    [name, email, passwordHash, "user"]
  );

  const user = buildUserPayload(result.rows[0]);

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await saveRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
}

async function login({ email, password }) {
  const result = await db.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );

  if (result.rows.length === 0) {
    throw {
      statusCode: 401,
      message: "Credenciais inválidas."
    };
  }

  const userRow = result.rows[0];
  const valid = await comparePassword(password, userRow.password_hash);

  if (!valid) {
    throw {
      statusCode: 401,
      message: "Credenciais inválidas."
    };
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
    SELECT id, name, email, role
    FROM users
    WHERE id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    throw {
      statusCode: 404,
      message: "Usuário não encontrado."
    };
  }

  return buildUserPayload(result.rows[0]);
}

// 🔥 NOVO: valida refresh token salvo
async function refreshSession(refreshToken) {
  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);

    const session = await db.query(
      "SELECT * FROM user_sessions WHERE refresh_token = $1",
      [refreshToken]
    );

    if (session.rows.length === 0) {
      throw new Error();
    }

    const user = await getUserById(decoded.id);

    const newAccess = generateAccessToken(user);
    const newRefresh = generateRefreshToken(user);

    await saveRefreshToken(user.id, newRefresh);

    return {
      user,
      accessToken: newAccess,
      refreshToken: newRefresh
    };
  } catch (_) {
    throw {
      statusCode: 401,
      message: "Refresh token inválido."
    };
  }
}

async function logout(refreshToken) {
  await db.query(
    "DELETE FROM user_sessions WHERE refresh_token = $1",
    [refreshToken]
  );

  return true;
}

async function bootstrapAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@aerix.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "123456";

  const existing = await db.query(
    "SELECT id FROM users WHERE email = $1",
    [adminEmail]
  );

  if (existing.rows.length > 0) {
    return { created: false };
  }

  const passwordHash = await hashPassword(adminPassword);

  const result = await db.query(
    `
    INSERT INTO users (name, email, password_hash, role)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, email, role
    `,
    ["Administrador", adminEmail, passwordHash, "admin"]
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
    throw {
      statusCode: 401,
      message: "Token inválido ou expirado."
    };
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