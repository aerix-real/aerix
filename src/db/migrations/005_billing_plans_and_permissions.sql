ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(40) NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP NULL;

ALTER TABLE users
  ALTER COLUMN plan SET DEFAULT 'FREE';

UPDATE users SET plan = UPPER(plan) WHERE plan <> UPPER(plan);

CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id);
