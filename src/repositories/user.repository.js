const db = require("../config/database");

async function findById(id) {
  const result = await db.query(
    `
    SELECT id, name, email, role, created_at
    FROM users
    WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function findByEmail(email) {
  const result = await db.query(
    `
    SELECT id, name, email, role, created_at
    FROM users
    WHERE email = $1
    `,
    [email]
  );

  return result.rows[0] || null;
}

async function listAll() {
  const result = await db.query(
    `
    SELECT id, name, email, role, created_at
    FROM users
    ORDER BY id ASC
    `
  );

  return result.rows;
}

async function updateProfile(id, { name, email }) {
  const result = await db.query(
    `
    UPDATE users
    SET
      name = $2,
      email = $3
    WHERE id = $1
    RETURNING id, name, email, role, created_at
    `,
    [id, name, email]
  );

  return result.rows[0] || null;
}

async function updateRole(id, role) {
  const result = await db.query(
    `
    UPDATE users
    SET role = $2
    WHERE id = $1
    RETURNING id, name, email, role, created_at
    `,
    [id, role]
  );

  return result.rows[0] || null;
}

module.exports = {
  findById,
  findByEmail,
  listAll,
  updateProfile,
  updateRole
};