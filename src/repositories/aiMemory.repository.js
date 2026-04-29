const db = require("../config/database");

class AiMemoryRepository {
  async ensureTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ai_loss_memory (
        id SERIAL PRIMARY KEY,
        memory_key TEXT UNIQUE NOT NULL,
        symbol TEXT,
        direction TEXT,
        strategy TEXT,
        hour INTEGER,
        total INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        last_results JSONB DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  }

  async getMemory(memoryKey) {
    await this.ensureTable();

    const result = await db.query(
      `SELECT * FROM ai_loss_memory WHERE memory_key = $1 LIMIT 1`,
      [memoryKey]
    );

    return result.rows[0] || null;
  }

  async upsertMemory(data) {
    await this.ensureTable();

    const {
      memoryKey,
      symbol,
      direction,
      strategy,
      hour,
      total,
      wins,
      losses,
      lastResults
    } = data;

    await db.query(
      `
      INSERT INTO ai_loss_memory (
        memory_key,
        symbol,
        direction,
        strategy,
        hour,
        total,
        wins,
        losses,
        last_results,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (memory_key)
      DO UPDATE SET
        symbol = EXCLUDED.symbol,
        direction = EXCLUDED.direction,
        strategy = EXCLUDED.strategy,
        hour = EXCLUDED.hour,
        total = EXCLUDED.total,
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        last_results = EXCLUDED.last_results,
        updated_at = NOW()
      `,
      [
        memoryKey,
        symbol,
        direction,
        strategy,
        hour,
        total,
        wins,
        losses,
        JSON.stringify(lastResults || [])
      ]
    );
  }

  async getBadPatterns(limit = 30) {
    await this.ensureTable();

    const result = await db.query(
      `
      SELECT *
      FROM ai_loss_memory
      WHERE total >= 3
      ORDER BY 
        CASE WHEN total > 0 THEN losses::decimal / total ELSE 0 END DESC,
        updated_at DESC
      LIMIT $1
      `,
      [limit]
    );

    return result.rows;
  }
}

module.exports = new AiMemoryRepository();