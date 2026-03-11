-- Migration 4: Create price_cache table for server-side price storage

CREATE TABLE IF NOT EXISTS price_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      text NOT NULL,
  asset_type  text NOT NULL CHECK (asset_type IN ('stock', 'crypto', 'etf', 'other')),
  price       numeric(24,8),
  currency    text DEFAULT 'USD',
  provider    text CHECK (provider IN ('finnhub', 'coingecko', 'manual')),
  fetched_at  timestamptz DEFAULT now(),
  UNIQUE (symbol, asset_type)
);
