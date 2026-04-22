const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:
    String(process.env.DB_SSL || "false") === "true"
      ? { rejectUnauthorized: false }
      : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};