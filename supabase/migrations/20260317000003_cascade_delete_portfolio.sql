-- Re-create positions FK with ON DELETE CASCADE
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_portfolio_id_fkey;
ALTER TABLE positions
  ADD CONSTRAINT positions_portfolio_id_fkey
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE;

-- Re-create trades FK with ON DELETE CASCADE (trades belong to a position)
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_position_id_fkey;
ALTER TABLE trades
  ADD CONSTRAINT trades_position_id_fkey
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE;
