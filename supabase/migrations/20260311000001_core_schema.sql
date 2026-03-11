-- Migration 1: Add missing columns to existing tables (additive, no data loss)

-- portfolios: add cash_balance and currency if not present
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS cash_balance numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

-- positions: add asset_id (FK to assets, nullable until assets table exists) and coin_id
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS coin_id text;

-- trades: add commission, currency, import_id
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS commission numeric(18,8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES imports(id) ON DELETE SET NULL;

-- dividends: add portfolio_id, asset_id, currency
ALTER TABLE dividends
  ADD COLUMN IF NOT EXISTS portfolio_id uuid REFERENCES portfolios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

-- imports: add status, broker, imported_at (ensure they exist)
ALTER TABLE imports
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS broker text DEFAULT 'ibkr',
  ADD COLUMN IF NOT EXISTS imported_at timestamptz DEFAULT now();

-- cash_adjustments: create or rename from adjustments if needed
-- We use CREATE TABLE IF NOT EXISTS to avoid errors if it already exists
CREATE TABLE IF NOT EXISTS cash_adjustments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid REFERENCES portfolios(id) ON DELETE CASCADE,
  previous_balance numeric(18,2),
  new_balance      numeric(18,2),
  date             date,
  notes            text,
  created_at       timestamptz DEFAULT now()
);

-- If the old 'adjustments' table exists, copy data and note migration
-- (We do this safely: if adjustments doesn't exist this block is a no-op)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'adjustments' AND table_schema = 'public') THEN
    INSERT INTO cash_adjustments (portfolio_id, previous_balance, new_balance, date, notes, created_at)
    SELECT portfolio_id, previous_balance, new_balance, date, notes, created_at
    FROM adjustments
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
