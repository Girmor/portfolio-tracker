-- Migration 8: Add user_id to user-owned tables (Phase 2 prep)
-- portfolios and imports get direct user_id.
-- positions, trades, dividends, etc. are already scoped through portfolios FK chain.

ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE imports    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_imports_user_id    ON imports(user_id);
