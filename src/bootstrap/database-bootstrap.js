const fs = require("fs");
const path = require("path");
const db = require("../config/database");


function logSchemaWarning(event, details = {}) {
  console.warn(
    JSON.stringify({
      level: "warn",
      component: "database-bootstrap",
      event,
      ...details
    })
  );
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function getColumnDataType(table, column) {
  const result = await db.query(
    `
    SELECT format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND a.attname = $2
      AND a.attnum > 0
      AND NOT a.attisdropped
    `,
    [table, column]
  );

  return result.rows[0]?.data_type || null;
}

async function dropConstraintIfExists(table, constraintName) {
  await db.query(
    `ALTER TABLE public.${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(constraintName)}`
  );
}

async function ensureForeignKeyConstraint({ table, column, constraintName, referencesTable, referencesColumn, onDelete }) {
  try {
    await dropConstraintIfExists(table, constraintName);
    await db.query(
      `ALTER TABLE public.${quoteIdent(table)}
       ADD CONSTRAINT ${quoteIdent(constraintName)}
       FOREIGN KEY (${quoteIdent(column)})
       REFERENCES public.${quoteIdent(referencesTable)}(${quoteIdent(referencesColumn)})
       ON DELETE ${onDelete}`
    );
  } catch (err) {
    logSchemaWarning("foreign_key_not_created", {
      table,
      column,
      constraint: constraintName,
      references: `public.${referencesTable}(${referencesColumn})`,
      error: err.message
    });
  }
}

async function ensureUserScopedColumnType(table, column, options = {}) {
  const { preserveLegacyValues = false, legacyColumnPrefix = `${column}_legacy` } = options;
  const usersIdType = await getColumnDataType("users", "id");

  if (!usersIdType) {
    logSchemaWarning("users_id_type_not_found", { table, column });
    return null;
  }

  const currentType = await getColumnDataType(table, column);

  if (!currentType) {
    await db.query(
      `ALTER TABLE public.${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${usersIdType}`
    );
    return usersIdType;
  }

  if (currentType === usersIdType) {
    return usersIdType;
  }

  await dropConstraintIfExists(table, `${table}_${column}_fkey`);

  try {
    await db.query(
      `ALTER TABLE public.${quoteIdent(table)}
       ALTER COLUMN ${quoteIdent(column)} DROP NOT NULL,
       ALTER COLUMN ${quoteIdent(column)} TYPE ${usersIdType}
       USING ${quoteIdent(column)}::text::${usersIdType}`
    );
    logSchemaWarning("user_scoped_column_type_corrected", {
      table,
      column,
      previousType: currentType,
      expectedType: usersIdType
    });
    return usersIdType;
  } catch (err) {
    if (!preserveLegacyValues) {
      logSchemaWarning("user_scoped_column_type_not_corrected", {
        table,
        column,
        previousType: currentType,
        expectedType: usersIdType,
        error: err.message
      });
      return null;
    }

    const legacyColumn = `${legacyColumnPrefix}_${currentType.replace(/[^a-zA-Z0-9_]/g, "_")}`.slice(0, 55);

    try {
      await db.query(
        `ALTER TABLE public.${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(legacyColumn)} TEXT`
      );
      await db.query(
        `UPDATE public.${quoteIdent(table)}
         SET ${quoteIdent(legacyColumn)} = ${quoteIdent(column)}::text
         WHERE ${quoteIdent(column)} IS NOT NULL
           AND ${quoteIdent(legacyColumn)} IS NULL`
      );
      await db.query(
        `ALTER TABLE public.${quoteIdent(table)} DROP COLUMN ${quoteIdent(column)}`
      );
      await db.query(
        `ALTER TABLE public.${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${usersIdType}`
      );
      logSchemaWarning("user_scoped_column_recreated_with_legacy_backup", {
        table,
        column,
        legacyColumn,
        previousType: currentType,
        expectedType: usersIdType,
        conversionError: err.message
      });
      return usersIdType;
    } catch (recoveryErr) {
      logSchemaWarning("user_scoped_column_recovery_failed", {
        table,
        column,
        previousType: currentType,
        expectedType: usersIdType,
        conversionError: err.message,
        recoveryError: recoveryErr.message
      });
      return null;
    }
  }
}


async function ensureNumericColumn(table, column, defaultValue = null) {
  try {
    const setDefault = defaultValue === null ? "" : `, ALTER COLUMN ${column} SET DEFAULT ${defaultValue}`;
    await db.query(
      `ALTER TABLE public.${table} ALTER COLUMN ${column} TYPE NUMERIC USING ${column}::numeric${setDefault}`
    );
  } catch (err) {
    console.error(`Erro ao normalizar coluna numérica ${column}:`, err.message);
  }
}

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
  await ensureColumn("signal_history", "confidence", "NUMERIC DEFAULT 0");
  await ensureNumericColumn("signal_history", "confidence", 0);
  await ensureColumn("signal_history", "signal", "TEXT");
  await ensureColumn("signal_history", "mode", "TEXT");
  await ensureColumn("signal_history", "trend_direction", "TEXT");
  await ensureColumn("signal_history", "trend_strength", "NUMERIC DEFAULT 0");
  await ensureColumn("signal_history", "volatility", "NUMERIC DEFAULT 0");
  await ensureColumn("signal_history", "entry_quality", "TEXT");
  await ensureColumn("signal_history", "strategy_name", "TEXT");

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
  await ensureColumn("signal_history", "execution_allowed", "BOOLEAN DEFAULT TRUE");
  await ensureColumn("signal_history", "minimum_score", "NUMERIC DEFAULT 0");
  await ensureColumn("signal_history", "adjusted_score", "NUMERIC DEFAULT 0");

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

  await db.query(`
    UPDATE public.signal_history
    SET adjusted_score = COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, 0)
    WHERE adjusted_score IS NULL OR adjusted_score = 0;
  `);

  await db.query(`
    UPDATE public.signal_history
    SET minimum_score = CASE
      WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 86
      WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 60
      ELSE 68
    END
    WHERE minimum_score IS NULL OR minimum_score = 0;
  `);

  await db.query(`
    UPDATE public.signal_history
    SET execution_allowed = CASE
      WHEN COALESCE(blocked, false) = false
        AND signal IN ('CALL', 'PUT')
        AND COALESCE(adjusted_score, final_score, confidence, 0) >= minimum_score
      THEN TRUE
      ELSE FALSE
    END;
  `);
}

async function ensureOutcomeAnalyticsTable() {
  const migrationPath = path.resolve(__dirname, "../db/migrations/014_outcome_tracking_analytics.sql");

  try {
    const sql = fs.readFileSync(migrationPath, "utf8");
    await db.query(sql);
  } catch (err) {
    logSchemaWarning("outcome_analytics_bootstrap_failed", {
      migrationPath,
      error: err.message
    });
    throw err;
  }
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
  await ensureColumn("users", "premium_until", "TIMESTAMP");
  await ensureColumn("users", "created_at", "TIMESTAMP DEFAULT NOW()");
}

async function ensurePreferencesTable() {
  const usersIdType = await getColumnDataType("users", "id");
  const userIdDefinition = usersIdType || "INTEGER";

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_preferences (
      id SERIAL PRIMARY KEY,
      user_id ${userIdDefinition},
      trading_mode TEXT DEFAULT 'balanced',
      preferred_symbols TEXT[],
      ai_explanations_enabled BOOLEAN DEFAULT TRUE,
      notifications_enabled BOOLEAN DEFAULT TRUE,
      panel_layout TEXT DEFAULT 'default',
      theme TEXT DEFAULT 'dark'
    );
  `);

  await ensureUserScopedColumnType("user_preferences", "user_id", {
    preserveLegacyValues: true
  });
  await ensureColumn("user_preferences", "trading_mode", "TEXT DEFAULT 'balanced'");
  await ensureColumn("user_preferences", "preferred_symbols", "TEXT[]");
  await ensureColumn("user_preferences", "ai_explanations_enabled", "BOOLEAN DEFAULT TRUE");
  await ensureColumn("user_preferences", "notifications_enabled", "BOOLEAN DEFAULT TRUE");
  await ensureColumn("user_preferences", "panel_layout", "TEXT DEFAULT 'default'");
  await ensureColumn("user_preferences", "theme", "TEXT DEFAULT 'dark'");

  await ensureForeignKeyConstraint({
    table: "user_preferences",
    column: "user_id",
    constraintName: "user_preferences_user_id_fkey",
    referencesTable: "users",
    referencesColumn: "id",
    onDelete: "CASCADE"
  });
}

async function ensureSessionsTable() {
  const usersIdType = await getColumnDataType("users", "id");
  const userIdDefinition = usersIdType || "INTEGER";

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_sessions (
      id SERIAL PRIMARY KEY,
      user_id ${userIdDefinition},
      refresh_token TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureUserScopedColumnType("user_sessions", "user_id");
  await ensureColumn("user_sessions", "refresh_token", "TEXT");
  await ensureColumn("user_sessions", "created_at", "TIMESTAMP DEFAULT NOW()");

  await ensureForeignKeyConstraint({
    table: "user_sessions",
    column: "user_id",
    constraintName: "user_sessions_user_id_fkey",
    referencesTable: "users",
    referencesColumn: "id",
    onDelete: "CASCADE"
  });
}

async function ensureBillingTable() {
  const usersIdType = await getColumnDataType("users", "id");
  const userIdDefinition = usersIdType || "INTEGER";

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id ${userIdDefinition},
      plan TEXT,
      status TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      current_period_end TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureUserScopedColumnType("billing_subscriptions", "user_id");
  await ensureColumn("billing_subscriptions", "plan", "TEXT");
  await ensureColumn("billing_subscriptions", "status", "TEXT");
  await ensureColumn("billing_subscriptions", "stripe_customer_id", "TEXT");
  await ensureColumn("billing_subscriptions", "stripe_subscription_id", "TEXT");
  await ensureColumn("billing_subscriptions", "current_period_end", "TIMESTAMP");
  await ensureColumn("billing_subscriptions", "created_at", "TIMESTAMP DEFAULT NOW()");

  await ensureForeignKeyConstraint({
    table: "billing_subscriptions",
    column: "user_id",
    constraintName: "billing_subscriptions_user_id_fkey",
    referencesTable: "users",
    referencesColumn: "id",
    onDelete: "CASCADE"
  });
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
  const usersIdType = await getColumnDataType("users", "id");
  const userIdDefinition = usersIdType || "INTEGER";

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.user_settings (
      id SERIAL PRIMARY KEY,
      user_id ${userIdDefinition} UNIQUE,
      mode TEXT DEFAULT 'equilibrado',
      preferred_timeframe TEXT DEFAULT 'M5',
      premium_unlocked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureUserScopedColumnType("user_settings", "user_id");

  await ensureForeignKeyConstraint({
    table: "user_settings",
    column: "user_id",
    constraintName: "user_settings_user_id_fkey",
    referencesTable: "users",
    referencesColumn: "id",
    onDelete: "CASCADE"
  });
}

async function ensureFilterBlockEventsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.filter_block_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      filter_name TEXT NOT NULL,
      filter_label TEXT NOT NULL,
      symbol TEXT NOT NULL,
      score NUMERIC DEFAULT 0,
      final_score NUMERIC DEFAULT 0,
      reason TEXT NOT NULL,
      signal TEXT DEFAULT 'WAIT',
      mode TEXT,
      market_regime TEXT,
      strategy_name TEXT,
      source TEXT NOT NULL DEFAULT 'engine',
      event_type TEXT NOT NULL DEFAULT 'block',
      original_score NUMERIC DEFAULT 0,
      result_outcome TEXT,
      event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await ensureColumn("filter_block_events", "user_id", "INTEGER");
  await ensureColumn("filter_block_events", "filter_name", "TEXT NOT NULL DEFAULT 'institutional_quality_filter'");
  await ensureColumn("filter_block_events", "filter_label", "TEXT NOT NULL DEFAULT 'Filtro de qualidade institucional'");
  await ensureColumn("filter_block_events", "symbol", "TEXT NOT NULL DEFAULT 'UNKNOWN'");
  await ensureColumn("filter_block_events", "score", "NUMERIC DEFAULT 0");
  await ensureColumn("filter_block_events", "final_score", "NUMERIC DEFAULT 0");
  await ensureColumn("filter_block_events", "reason", "TEXT NOT NULL DEFAULT 'Bloqueio institucional sem motivo detalhado.'");
  await ensureColumn("filter_block_events", "signal", "TEXT DEFAULT 'WAIT'");
  await ensureColumn("filter_block_events", "mode", "TEXT");
  await ensureColumn("filter_block_events", "market_regime", "TEXT");
  await ensureColumn("filter_block_events", "strategy_name", "TEXT");
  await ensureColumn("filter_block_events", "source", "TEXT NOT NULL DEFAULT 'engine'");
  await ensureColumn("filter_block_events", "event_type", "TEXT NOT NULL DEFAULT 'block'");
  await ensureColumn("filter_block_events", "original_score", "NUMERIC DEFAULT 0");
  await ensureColumn("filter_block_events", "result_outcome", "TEXT");
  await ensureColumn("filter_block_events", "event_timestamp", "TIMESTAMP NOT NULL DEFAULT NOW()");
  await ensureColumn("filter_block_events", "created_at", "TIMESTAMP NOT NULL DEFAULT NOW()");

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_filter_block_events_filter_name
      ON public.filter_block_events(filter_name);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_filter_block_events_symbol
      ON public.filter_block_events(symbol);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_filter_block_events_created_at
      ON public.filter_block_events(created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_filter_block_events_event_timestamp
      ON public.filter_block_events(event_timestamp DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_filter_block_events_event_type
      ON public.filter_block_events(event_type);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_filter_block_events_symbol_signal_timestamp
      ON public.filter_block_events(symbol, signal, event_timestamp DESC);
  `);
}

async function ensureDynamicThresholdTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.threshold_history (
      id SERIAL PRIMARY KEY,
      scope_type TEXT NOT NULL DEFAULT 'composite',
      scope_key TEXT NOT NULL DEFAULT 'global',
      symbol TEXT,
      hour INTEGER,
      strategy_name TEXT,
      market_regime TEXT,
      mode TEXT DEFAULT 'balanced',
      minimum_score NUMERIC DEFAULT 72,
      confidence NUMERIC DEFAULT 72,
      sniper_timing NUMERIC DEFAULT 88,
      adaptive_adjustment NUMERIC DEFAULT 0,
      performance_snapshot JSONB DEFAULT '{}'::jsonb,
      reasons JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("threshold_history", "scope_type", "TEXT NOT NULL DEFAULT 'composite'");
  await ensureColumn("threshold_history", "scope_key", "TEXT NOT NULL DEFAULT 'global'");
  await ensureColumn("threshold_history", "symbol", "TEXT");
  await ensureColumn("threshold_history", "hour", "INTEGER");
  await ensureColumn("threshold_history", "strategy_name", "TEXT");
  await ensureColumn("threshold_history", "market_regime", "TEXT");
  await ensureColumn("threshold_history", "mode", "TEXT DEFAULT 'balanced'");
  await ensureColumn("threshold_history", "minimum_score", "NUMERIC DEFAULT 72");
  await ensureColumn("threshold_history", "confidence", "NUMERIC DEFAULT 72");
  await ensureColumn("threshold_history", "sniper_timing", "NUMERIC DEFAULT 88");
  await ensureColumn("threshold_history", "adaptive_adjustment", "NUMERIC DEFAULT 0");
  await ensureColumn("threshold_history", "performance_snapshot", "JSONB DEFAULT '{}'::jsonb");
  await ensureColumn("threshold_history", "reasons", "JSONB DEFAULT '[]'::jsonb");
  await ensureColumn("threshold_history", "created_at", "TIMESTAMP DEFAULT NOW()");

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.threshold_changes (
      id SERIAL PRIMARY KEY,
      scope_type TEXT NOT NULL DEFAULT 'composite',
      scope_key TEXT NOT NULL DEFAULT 'global',
      threshold_name TEXT NOT NULL,
      previous_value NUMERIC DEFAULT 0,
      new_value NUMERIC DEFAULT 0,
      delta NUMERIC DEFAULT 0,
      reason TEXT,
      context JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("threshold_changes", "scope_type", "TEXT NOT NULL DEFAULT 'composite'");
  await ensureColumn("threshold_changes", "scope_key", "TEXT NOT NULL DEFAULT 'global'");
  await ensureColumn("threshold_changes", "threshold_name", "TEXT NOT NULL DEFAULT 'unknown'");
  await ensureColumn("threshold_changes", "previous_value", "NUMERIC DEFAULT 0");
  await ensureColumn("threshold_changes", "new_value", "NUMERIC DEFAULT 0");
  await ensureColumn("threshold_changes", "delta", "NUMERIC DEFAULT 0");
  await ensureColumn("threshold_changes", "reason", "TEXT");
  await ensureColumn("threshold_changes", "context", "JSONB DEFAULT '{}'::jsonb");
  await ensureColumn("threshold_changes", "created_at", "TIMESTAMP DEFAULT NOW()");

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.threshold_performance (
      id SERIAL PRIMARY KEY,
      scope_type TEXT NOT NULL DEFAULT 'composite',
      scope_key TEXT NOT NULL DEFAULT 'global',
      symbol TEXT,
      hour INTEGER,
      strategy_name TEXT,
      market_regime TEXT,
      total INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      winrate NUMERIC DEFAULT 0,
      lossrate NUMERIC DEFAULT 0,
      last_thresholds JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (scope_type, scope_key)
    );
  `);

  await ensureColumn("threshold_performance", "scope_type", "TEXT NOT NULL DEFAULT 'composite'");
  await ensureColumn("threshold_performance", "scope_key", "TEXT NOT NULL DEFAULT 'global'");
  await ensureColumn("threshold_performance", "symbol", "TEXT");
  await ensureColumn("threshold_performance", "hour", "INTEGER");
  await ensureColumn("threshold_performance", "strategy_name", "TEXT");
  await ensureColumn("threshold_performance", "market_regime", "TEXT");
  await ensureColumn("threshold_performance", "total", "INTEGER DEFAULT 0");
  await ensureColumn("threshold_performance", "wins", "INTEGER DEFAULT 0");
  await ensureColumn("threshold_performance", "losses", "INTEGER DEFAULT 0");
  await ensureColumn("threshold_performance", "winrate", "NUMERIC DEFAULT 0");
  await ensureColumn("threshold_performance", "lossrate", "NUMERIC DEFAULT 0");
  await ensureColumn("threshold_performance", "last_thresholds", "JSONB DEFAULT '{}'::jsonb");
  await ensureColumn("threshold_performance", "updated_at", "TIMESTAMP DEFAULT NOW()");

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_threshold_history_scope_created
      ON public.threshold_history (scope_type, scope_key, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_threshold_history_symbol_created
      ON public.threshold_history (symbol, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_threshold_history_strategy_created
      ON public.threshold_history (strategy_name, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_threshold_changes_scope_created
      ON public.threshold_changes (scope_type, scope_key, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_threshold_performance_scope
      ON public.threshold_performance (scope_type, scope_key);
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM public.threshold_performance
        GROUP BY scope_type, scope_key
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_threshold_performance_scope_unique
          ON public.threshold_performance (scope_type, scope_key);
      ELSE
        RAISE NOTICE 'idx_threshold_performance_scope_unique not created: duplicate threshold_performance scope rows require manual consolidation.';
      END IF;
    END $$;
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
  await ensureOutcomeAnalyticsTable();
  await ensureBillingTable();
  await ensureAuditLogsTable();
  await ensureFilterBlockEventsTable();
  await ensureDynamicThresholdTables();

  console.log("✅ Banco pronto para IA institucional");
  await logSignalHistoryColumns();
}

module.exports = {
  bootstrapDatabase,
  runDatabaseBootstrap: bootstrapDatabase
};
