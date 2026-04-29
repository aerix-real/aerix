const db = require("../config/database");

async function ensureColumn(table, column, definition) {
  try {
    const check = await db.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      `,
      [table, column]
    );

    if (check.rows.length === 0) {
      console.log(`🧱 Adicionando coluna ${column} em ${table}`);
      await db.query(
        `ALTER TABLE public.${table} ADD COLUMN ${column} ${definition}`
      );
    }
  } catch (err) {
    console.error(`Erro ao garantir coluna ${column}:`, err.message);
  }
}

async function ensureSignalHistoryTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.signal_history (
      id SERIAL PRIMARY KEY,
      symbol TEXT,
      direction TEXT,
      timeframe TEXT,
      confidence NUMERIC,
      final_score NUMERIC,
      strategy_name TEXT,
      result TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      entry_price NUMERIC,
      result_price NUMERIC,
      checked_at TIMESTAMP
    );
  `);

  await ensureColumn("signal_history", "user_id", "INTEGER");
  await ensureColumn("signal_history", "signal", "TEXT");
  await ensureColumn("signal_history", "mode", "TEXT");
  await ensureColumn("signal_history", "trend_direction", "TEXT");
  await ensureColumn("signal_history", "trend_strength", "NUMERIC DEFAULT 0");
  await ensureColumn("signal_history", "volatility", "NUMERIC DEFAULT 0");
  await ensureColumn("signal_history", "entry_quality", "TEXT");

  await ensureColumn("signal_history", "blocked", "BOOLEAN DEFAULT FALSE");
  await ensureColumn("signal_history", "block_reason", "TEXT");
  await ensureColumn("signal_history", "explanation", "TEXT");

  await ensureColumn("signal_history", "timing", "TEXT");
  await ensureColumn("signal_history", "entry_in_seconds", "INTEGER DEFAULT 0");
  await ensureColumn("signal_history", "timing_mode", "TEXT");
  await ensureColumn("signal_history", "timing_confidence", "NUMERIC");

  await ensureColumn("signal_history", "market_regime", "TEXT");
  await ensureColumn("signal_history", "institutional_quality", "TEXT");
  await ensureColumn("signal_history", "adaptive_adjustment", "NUMERIC DEFAULT 0");
  await ensureColumn("signal_history", "tuning_weight", "NUMERIC DEFAULT 1");

  await db.query(`
    UPDATE public.signal_history
    SET signal = direction
    WHERE signal IS NULL
      AND direction IS NOT NULL;
  `);

  await db.query(`
    UPDATE public.signal_history
    SET final_score = 0
    WHERE final_score IS NULL;
  `);

  await db.query(`
    UPDATE public.signal_history
    SET result = 'pending'
    WHERE result IS NULL;
  `);
}

async function ensureUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'user',
      plan TEXT DEFAULT 'free',
      created_at TIMESTAMP DEFAULT NOW(),
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT
    );
  `);

  await ensureColumn("users", "name", "TEXT");
  await ensureColumn("users", "email", "TEXT");
  await ensureColumn("users", "password_hash", "TEXT");
  await ensureColumn("users", "role", "TEXT DEFAULT 'user'");
  await ensureColumn("users", "plan", "TEXT DEFAULT 'free'");
  await ensureColumn("users", "stripe_customer_id", "TEXT");
  await ensureColumn("users", "stripe_subscription_id", "TEXT");
  await ensureColumn("users", "subscription_status", "TEXT");
  await ensureColumn("users", "created_at", "TIMESTAMP DEFAULT NOW()");
}

async function ensurePreferencesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
      trading_mode TEXT DEFAULT 'balanced',
      preferred_symbols TEXT[],
      ai_explanations_enabled BOOLEAN DEFAULT TRUE,
      notifications_enabled BOOLEAN DEFAULT TRUE,
      panel_layout TEXT DEFAULT 'default',
      theme TEXT DEFAULT 'dark'
    );
  `);

  await ensureColumn("user_preferences", "user_id", "INTEGER");
  await ensureColumn("user_preferences", "trading_mode", "TEXT DEFAULT 'balanced'");
  await ensureColumn("user_preferences", "preferred_symbols", "TEXT[]");
  await ensureColumn("user_preferences", "ai_explanations_enabled", "BOOLEAN DEFAULT TRUE");
  await ensureColumn("user_preferences", "notifications_enabled", "BOOLEAN DEFAULT TRUE");
  await ensureColumn("user_preferences", "panel_layout", "TEXT DEFAULT 'default'");
  await ensureColumn("user_preferences", "theme", "TEXT DEFAULT 'dark'");
}

async function ensureSessionsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
      refresh_token TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("user_sessions", "user_id", "INTEGER");
  await ensureColumn("user_sessions", "refresh_token", "TEXT");
  await ensureColumn("user_sessions", "created_at", "TIMESTAMP DEFAULT NOW()");
}

async function ensureBillingTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
      plan TEXT,
      status TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      current_period_end TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("billing_subscriptions", "user_id", "INTEGER");
  await ensureColumn("billing_subscriptions", "plan", "TEXT");
  await ensureColumn("billing_subscriptions", "status", "TEXT");
  await ensureColumn("billing_subscriptions", "stripe_customer_id", "TEXT");
  await ensureColumn("billing_subscriptions", "stripe_subscription_id", "TEXT");
  await ensureColumn("billing_subscriptions", "current_period_end", "TIMESTAMP");
  await ensureColumn("billing_subscriptions", "created_at", "TIMESTAMP DEFAULT NOW()");
}

async function ensureAuditLogsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      event_type TEXT,
      description TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function ensureUserSettingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_settings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
      mode TEXT DEFAULT 'equilibrado',
      preferred_timeframe TEXT DEFAULT 'M5',
      premium_unlocked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function logSignalHistoryColumns() {
  const cols = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'signal_history'
    ORDER BY ordinal_position;
  `);

  console.log(
    "✅ signal_history pronta:",
    cols.rows.map((row) => row.column_name)
  );
}

async function bootstrapDatabase() {
  console.log("🚀 Iniciando bootstrap do banco...");

  await ensureUsersTable();
  await ensurePreferencesTable();
  await ensureSessionsTable();
  await ensureUserSettingsTable();
  await ensureSignalHistoryTable();
  await ensureBillingTable();
  await ensureAuditLogsTable();

  console.log("✅ Banco pronto para IA institucional");
  await logSignalHistoryColumns();
}

module.exports = {
  bootstrapDatabase,
  runDatabaseBootstrap: bootstrapDatabase
};