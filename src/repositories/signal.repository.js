const { pool } = require("../db/connection");

async function createSignalHistory({
  userId = null,
  symbol,
  direction,
  score = 0,
  confidence = 0,
  strategy = null,
  mode = null,
  result = "Pendente",
  meta = {}
}) {
  const query = `
    INSERT INTO signal_history (
      user_id,
      symbol,
      direction,
      score,
      confidence,
      strategy,
      mode,
      result,
      meta
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    RETURNING *
  `;

  const values = [
    userId,
    symbol,
    direction,
    score,
    confidence,
    strategy,
    mode,
    result,
    JSON.stringify(meta || {})
  ];

  const resultQuery = await pool.query(query, values);
  return resultQuery.rows[0] || null;
}

async function getRecentSignals(limit = 8, userId = null) {
  const safeLimit = Number(limit) || 8;

  if (userId) {
    const query = `
      SELECT *
      FROM signal_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [userId, safeLimit]);
    return result.rows;
  }

  const query = `
    SELECT *
    FROM signal_history
    ORDER BY created_at DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [safeLimit]);
  return result.rows;
}

async function getSignalStats(userId = null) {
  if (userId) {
    const query = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE result = 'Win')::int AS wins,
        COUNT(*) FILTER (WHERE result = 'Loss')::int AS losses,
        COUNT(*) FILTER (WHERE result = 'Pendente')::int AS pending
      FROM signal_history
      WHERE user_id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  const query = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE result = 'Win')::int AS wins,
      COUNT(*) FILTER (WHERE result = 'Loss')::int AS losses,
      COUNT(*) FILTER (WHERE result = 'Pendente')::int AS pending
    FROM signal_history
  `;

  const result = await pool.query(query);
  return result.rows[0];
}

module.exports = {
  createSignalHistory,
  getRecentSignals,
  getSignalStats
};