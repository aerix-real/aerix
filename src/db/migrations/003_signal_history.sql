CREATE TABLE IF NOT EXISTS signal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  symbol VARCHAR(30) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  strategy VARCHAR(50),
  mode VARCHAR(30),
  result VARCHAR(20) NOT NULL DEFAULT 'Pendente',
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);