const { pool } = require("../db/connection");

async function createDefaultSettingsForUser(userId) {
  const query = `
    INSERT INTO user_settings (
      user_id,
      mode,
      preferred_timeframe,
      premium_unlocked
    )
    VALUES ($1, 'equilibrado', 'M5', false)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING *
  `;

  const result = await pool.query(query, [userId]);
  return result.rows[0] || null;
}

async function findSettingsByUserId(userId) {
  const query = `
    SELECT
      id,
      user_id,
      mode,
      preferred_timeframe,
      premium_unlocked,
      created_at,
      updated_at
    FROM user_settings
    WHERE user_id = $1
    LIMIT 1
  `;

  const result = await pool.query(query, [userId]);
  return result.rows[0] || null;
}

module.exports = {
  createDefaultSettingsForUser,
  findSettingsByUserId
};