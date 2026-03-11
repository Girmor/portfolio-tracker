-- Migration 5: Performance indexes

-- positions
CREATE INDEX IF NOT EXISTS idx_positions_portfolio_id ON positions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_positions_asset_id ON positions(asset_id);

-- trades
CREATE INDEX IF NOT EXISTS idx_trades_position_id ON trades(position_id);
CREATE INDEX IF NOT EXISTS idx_trades_import_id ON trades(import_id);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);

-- dividends
CREATE INDEX IF NOT EXISTS idx_dividends_portfolio_id ON dividends(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_dividends_date ON dividends(date);

-- snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);

-- imports
CREATE INDEX IF NOT EXISTS idx_imports_portfolio_id ON imports(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_imports_imported_at ON imports(imported_at);

-- import_rows
CREATE INDEX IF NOT EXISTS idx_import_rows_import_id ON import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_import_status ON import_rows(import_id, status);

-- price_cache
CREATE INDEX IF NOT EXISTS idx_price_cache_symbol_type ON price_cache(symbol, asset_type);

-- assets
CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);
