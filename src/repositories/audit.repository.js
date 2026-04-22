const { pool } = require("../db/connection");

async function createAuditLog({
  userId = null,
  eventType,
  description,
  meta = {}
}) {
  const query = `
    INSERT INTO audit_logs (
      user_id,
      event_type,
      description,
      meta
    )
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING *
  `;

  const values = [
    userId,
    eventType,
    description,
    JSON.stringify(meta || {})
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function getRecentAuditLogs(limit = 20) {
  const query = `
    SELECT *
    FROM audit_logs
    ORDER BY created_at DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [Number(limit) || 20]);
  return result.rows;
}

module.exports = {
  createAuditLog,
  getRecentAuditLogs
};