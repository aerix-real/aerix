const { Pool } = require("pg");
const env = require("../config/env");

const pool = new Pool({
  connectionString: env.db.url
});

pool.on("error", (error) => {
  console.error("Erro inesperado no pool PostgreSQL:", error);
});

async function testDatabaseConnection() {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  testDatabaseConnection
};