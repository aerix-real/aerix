const db = require("../config/database");

async function createAuditLog({
  userId = null,
  eventType = "system_event",
  description = "",
  meta = {}
}) {
  const query = `
    INSERT INTO public.audit_logs (
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

  const result = await db.query(query, values);
  return result.rows[0] || null;
}

async function getRecentAuditLogs(limit = 20) {
  const result = await db.query(
    `
    SELECT *
    FROM public.audit_logs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [Number(limit) || 20]
  );

  return result.rows;
}

module.exports = {
  createAuditLog,
  getRecentAuditLogs
};