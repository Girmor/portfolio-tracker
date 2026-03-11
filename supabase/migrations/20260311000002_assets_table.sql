-- Migration 2: Create assets table and seed with crypto map

CREATE TABLE IF NOT EXISTS assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text NOT NULL,
  name            text,
  asset_type      text NOT NULL CHECK (asset_type IN ('stock', 'crypto', 'etf', 'other')),
  currency        text DEFAULT 'USD',
  exchange        text,
  coin_gecko_id   text,
  finnhub_symbol  text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (symbol, asset_type)
);

-- Seed with CRYPTO_MAP from priceService.js
INSERT INTO assets (symbol, name, asset_type, coin_gecko_id) VALUES
  ('BTC',   'Bitcoin',       'crypto', 'bitcoin'),
  ('ETH',   'Ethereum',      'crypto', 'ethereum'),
  ('SOL',   'Solana',        'crypto', 'solana'),
  ('ADA',   'Cardano',       'crypto', 'cardano'),
  ('DOT',   'Polkadot',      'crypto', 'polkadot'),
  ('MATIC', 'Polygon',       'crypto', 'matic-network'),
  ('AVAX',  'Avalanche',     'crypto', 'avalanche-2'),
  ('LINK',  'Chainlink',     'crypto', 'chainlink'),
  ('UNI',   'Uniswap',       'crypto', 'uniswap'),
  ('ATOM',  'Cosmos',        'crypto', 'cosmos'),
  ('XRP',   'XRP',           'crypto', 'ripple'),
  ('DOGE',  'Dogecoin',      'crypto', 'dogecoin'),
  ('SHIB',  'Shiba Inu',     'crypto', 'shiba-inu'),
  ('LTC',   'Litecoin',      'crypto', 'litecoin'),
  ('BNB',   'BNB',           'crypto', 'binancecoin')
ON CONFLICT (symbol, asset_type) DO UPDATE SET
  coin_gecko_id = EXCLUDED.coin_gecko_id,
  updated_at    = now();

-- Add asset_id FK to positions (after assets table exists)
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id) ON DELETE SET NULL;

-- Back-populate positions.asset_id for crypto positions using coin_id or ticker
UPDATE positions p
SET asset_id = a.id
FROM assets a
WHERE p.asset_id IS NULL
  AND p.type = 'crypto'
  AND UPPER(p.ticker) = a.symbol
  AND a.asset_type = 'crypto';

-- Back-populate positions.coin_id for crypto from assets table
UPDATE positions p
SET coin_id = a.coin_gecko_id
FROM assets a
WHERE p.coin_id IS NULL
  AND p.asset_id = a.id
  AND a.coin_gecko_id IS NOT NULL;
