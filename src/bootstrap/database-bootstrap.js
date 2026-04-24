const db = require("../config/database");

async function ensureUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      plan TEXT DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
  `);

  await db.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
  `);

  await db.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
  `);

  await db.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS subscription_status TEXT;
  `);
}

async function ensureUserSessionsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      refresh_token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function ensureUserPreferencesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
      trading_mode TEXT DEFAULT 'balanced',
      preferred_symbols TEXT[],
      ai_explanations_enabled BOOLEAN DEFAULT true,
      notifications_enabled BOOLEAN DEFAULT true,
      panel_layout TEXT DEFAULT 'default',
      theme TEXT DEFAULT 'dark'
    );
  `);

  await db.query(`
    ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS trading_mode TEXT DEFAULT 'balanced';
  `);

  await db.query(`
    ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS preferred_symbols TEXT[];
  `);

  await db.query(`
    ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS ai_explanations_enabled BOOLEAN DEFAULT true;
  `);

  await db.query(`
    ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
  `);

  await db.query(`
    ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS panel_layout TEXT DEFAULT 'default';
  `);

  await db.query(`
    ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark';
  `);
}

async function ensureSignalHistoryTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.signal_history (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      direction TEXT,
      timeframe TEXT,
      confidence NUMERIC,
      result TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS user_id INTEGER;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS signal TEXT;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS final_score NUMERIC DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS entry_quality TEXT;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS strategy_name TEXT;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS mode TEXT;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS trend_direction TEXT;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS trend_strength NUMERIC DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS volatility NUMERIC DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS entry_price NUMERIC;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS result_price NUMERIC;
  `);

  await db.query(`
    ALTER TABLE public.signal_history
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
  `);

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
}

async function ensureBillingSubscriptionsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT,
      plan TEXT,
      current_period_end TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function logSignalHistoryColumns() {
  const cols = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'signal_history'
    ORDER BY ordinal_position
  `);

  console.log(
    "✅ signal_history pronta:",
    cols.rows.map((row) => row.column_name)
  );
}

async function bootstrapDatabase() {
  console.log("🛠 Iniciando bootstrap do banco...");

  await ensureUsersTable();
  await ensureUserSessionsTable();
  await ensureUserPreferencesTable();
  await ensureSignalHistoryTable();
  await ensureBillingSubscriptionsTable();

  console.log("✅ Estrutura principal do banco validada.");
  await logSignalHistoryColumns();
}

module.exports = {
  bootstrapDatabase
};