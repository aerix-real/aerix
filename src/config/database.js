const { Pool } = require("pg");
require("dotenv").config();

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const pool = new Pool(
  hasDatabaseUrl
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "aerix",
        ssl:
          String(process.env.DB_SSL || "false").toLowerCase() === "true"
            ? { rejectUnauthorized: false }
            : false
      }
);

pool.on("error", (error) => {
  console.error("Erro inesperado no pool PostgreSQL:", error);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};