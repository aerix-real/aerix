#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourceRoots = ["src"];
const migrationPath = path.join(repoRoot, "src/db/migrations/012_complete_schema_audit_compatibility.sql");

const requiredSchema = {
  users: [
    "id",
    "name",
    "email",
    "password_hash",
    "role",
    "plan",
    "is_active",
    "stripe_customer_id",
    "stripe_subscription_id",
    "subscription_status",
    "premium_until",
    "created_at",
    "updated_at"
  ],
  user_sessions: ["id", "user_id", "refresh_token", "created_at"],
  user_settings: [
    "id",
    "user_id",
    "mode",
    "preferred_timeframe",
    "premium_unlocked",
    "created_at",
    "updated_at"
  ],
  user_preferences: [
    "id",
    "user_id",
    "trading_mode",
    "preferred_symbols",
    "ai_explanations_enabled",
    "notifications_enabled",
    "panel_layout",
    "theme",
    "created_at",
    "updated_at"
  ],
  billing_subscriptions: [
    "id",
    "user_id",
    "plan",
    "status",
    "stripe_customer_id",
    "stripe_subscription_id",
    "current_period_end",
    "created_at",
    "updated_at"
  ],
  audit_logs: ["id", "user_id", "event_type", "description", "meta", "created_at"],
  signal_history: [
    "id",
    "user_id",
    "symbol",
    "direction",
    "signal",
    "timeframe",
    "score",
    "confidence",
    "final_score",
    "adjusted_score",
    "minimum_score",
    "entry_quality",
    "strategy",
    "strategy_name",
    "result",
    "mode",
    "trend_direction",
    "trend_strength",
    "volatility",
    "entry_price",
    "result_price",
    "expires_at",
    "checked_at",
    "blocked",
    "block_reason",
    "explanation",
    "timing",
    "entry_in_seconds",
    "timing_mode",
    "timing_confidence",
    "market_regime",
    "institutional_quality",
    "adaptive_adjustment",
    "tuning_weight",
    "execution_allowed",
    "meta",
    "created_at"
  ],
  filter_block_events: [
    "id",
    "user_id",
    "filter_name",
    "filter_label",
    "symbol",
    "score",
    "final_score",
    "reason",
    "signal",
    "mode",
    "market_regime",
    "strategy_name",
    "source",
    "event_type",
    "original_score",
    "result_outcome",
    "event_timestamp",
    "created_at"
  ],
  threshold_history: [
    "id",
    "scope_type",
    "scope_key",
    "symbol",
    "hour",
    "strategy_name",
    "market_regime",
    "mode",
    "minimum_score",
    "confidence",
    "sniper_timing",
    "adaptive_adjustment",
    "performance_snapshot",
    "reasons",
    "created_at"
  ],
  threshold_changes: [
    "id",
    "scope_type",
    "scope_key",
    "threshold_name",
    "previous_value",
    "new_value",
    "delta",
    "reason",
    "context",
    "created_at"
  ],
  threshold_performance: [
    "id",
    "scope_type",
    "scope_key",
    "symbol",
    "hour",
    "strategy_name",
    "market_regime",
    "total",
    "wins",
    "losses",
    "winrate",
    "lossrate",
    "last_thresholds",
    "updated_at"
  ],
  ai_loss_memory: [
    "id",
    "memory_key",
    "symbol",
    "direction",
    "strategy",
    "hour",
    "total",
    "wins",
    "losses",
    "last_results",
    "updated_at"
  ]
};

const requiredIndexes = [
  "idx_users_email_unique",
  "idx_users_plan",
  "idx_users_stripe_customer",
  "idx_users_stripe_subscription",
  "idx_user_sessions_user_id",
  "idx_user_sessions_refresh_token",
  "idx_user_settings_user_id_unique",
  "idx_user_preferences_user_id_unique",
  "idx_signal_history_created_at",
  "idx_signal_history_symbol_created",
  "idx_signal_history_result_created",
  "idx_signal_history_expires_result",
  "idx_signal_history_execution_allowed",
  "idx_signal_history_confirmed_operational",
  "idx_signal_history_strategy_created",
  "idx_filter_block_events_filter_name",
  "idx_filter_block_events_symbol",
  "idx_filter_block_events_created_at",
  "idx_filter_block_events_event_timestamp",
  "idx_filter_block_events_event_type",
  "idx_filter_block_events_symbol_signal_timestamp",
  "idx_threshold_history_scope_created",
  "idx_threshold_history_symbol_created",
  "idx_threshold_history_strategy_created",
  "idx_threshold_changes_scope_created",
  "idx_threshold_performance_scope_unique",
  "idx_ai_loss_memory_key_unique"
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", "dist", "build"].includes(entry.name)) return [];
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (/\.(js|sql)$/.test(entry.name) || entry.name.endsWith(".repository")) return [fullPath];
    return [];
  });
}

function normalizeTableName(name) {
  return name.replace(/^public\./, "");
}

const migration = fs.readFileSync(migrationPath, "utf8").toLowerCase();
const sourceFiles = sourceRoots.flatMap((root) => walk(path.join(repoRoot, root)));
const sourceSql = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n").toLowerCase();

const referencedTables = new Set();
const tableRegex = /\b(?:from|join|into|update)\s+(?:public\.)?([a-z_][a-z0-9_]*)\b/g;
let match;
while ((match = tableRegex.exec(sourceSql))) {
  const table = normalizeTableName(match[1]);
  if (!["information_schema", "columns", "set", "created_at", "event_timestamp"].includes(table)) referencedTables.add(table);
}

const failures = [];

for (const table of referencedTables) {
  if (!requiredSchema[table]) {
    failures.push(`Tabela referenciada sem contrato de schema: ${table}`);
  }
}

for (const [table, columns] of Object.entries(requiredSchema)) {
  const createTablePattern = new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+(?:public\\.)?${table}\\b`, "i");
  if (!createTablePattern.test(migration)) {
    failures.push(`Migration não cria tabela idempotente: ${table}`);
  }

  for (const column of columns) {
    const columnPattern = new RegExp(`\\b${column}\\b`, "i");
    if (!columnPattern.test(migration)) {
      failures.push(`Migration não cobre coluna ${table}.${column}`);
    }
  }
}

for (const indexName of requiredIndexes) {
  const indexPattern = new RegExp(`create\\s+(?:unique\\s+)?index\\s+if\\s+not\\s+exists\\s+${indexName}\\b`, "i");
  if (!indexPattern.test(migration)) {
    failures.push(`Migration não cria índice idempotente: ${indexName}`);
  }
}

const unsafeAlter = migration
  .split("\n")
  .map((line, idx) => ({ line: line.trim(), number: idx + 1 }))
  .filter(({ line }) => line.startsWith("add column") && !line.includes("if not exists"));

for (const item of unsafeAlter) {
  failures.push(`ADD COLUMN sem IF NOT EXISTS na linha ${item.number}: ${item.line}`);
}

if (failures.length) {
  console.error("❌ Falha na validação de compatibilidade do schema:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("✅ Compatibilidade estática validada: tabelas, colunas e índices requeridos pelas queries estão cobertos.");
console.log("✅ Alvos de erro 42703/42P01 cobertos pela migration 012_complete_schema_audit_compatibility.sql.");
