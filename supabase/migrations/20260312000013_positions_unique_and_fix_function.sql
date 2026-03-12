-- Migration 13: Add unique constraint on positions(ticker, portfolio_id)
-- and fix commit_ibkr_import ON CONFLICT clause.
--
-- Problem: migration 12 used ON CONFLICT (ticker, portfolio_id) DO NOTHING
-- which requires a unique constraint that didn't exist → function threw
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" → edge function returned 500.
--
-- Fix:
-- 1. Deduplicate existing positions with same (ticker, portfolio_id),
--    migrating their trades to the surviving row.
-- 2. Add UNIQUE INDEX on (ticker, portfolio_id).
-- 3. Rebuild the function — now ON CONFLICT (ticker, portfolio_id) is valid.

-- ── Step 1: deduplicate positions ────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  keep_id uuid;
  dup_id  uuid;
BEGIN
  -- Find every (ticker, portfolio_id) group with more than one position
  FOR r IN
    SELECT ticker, portfolio_id
    FROM positions
    GROUP BY ticker, portfolio_id
    HAVING COUNT(*) > 1
  LOOP
    -- Keep the position with the most trades (or the oldest by created_at)
    SELECT id INTO keep_id
    FROM positions
    WHERE ticker = r.ticker AND portfolio_id = r.portfolio_id
    ORDER BY (SELECT COUNT(*) FROM trades WHERE position_id = positions.id) DESC,
             created_at ASC
    LIMIT 1;

    -- Move trades from all other duplicates to keep_id
    UPDATE trades
    SET position_id = keep_id
    WHERE position_id IN (
      SELECT id FROM positions
      WHERE ticker = r.ticker AND portfolio_id = r.portfolio_id
        AND id <> keep_id
    );

    -- Delete the now-empty duplicate positions
    DELETE FROM positions
    WHERE ticker = r.ticker AND portfolio_id = r.portfolio_id
      AND id <> keep_id;
  END LOOP;
END $$;

-- ── Step 2: add unique constraint ────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_ticker_portfolio
  ON positions (ticker, portfolio_id);

-- ── Step 3: rebuild function with correct ON CONFLICT clause ─────────────────
DROP FUNCTION IF EXISTS commit_ibkr_import(uuid, text, text, jsonb, jsonb, numeric, jsonb, uuid);

CREATE FUNCTION commit_ibkr_import(
  p_portfolio_id    uuid,
  p_filename        text,
  p_broker          text,
  p_trades          jsonb,
  p_dividends       jsonb,
  p_ending_cash     numeric,
  p_summary         jsonb,
  p_user_id         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_import_id         uuid;
  v_previous_cash     numeric;
  v_trade             jsonb;
  v_dividend          jsonb;
  v_position_id       uuid;
  v_trade_id          uuid;
  v_dividend_id       uuid;
  v_trades_imported   integer := 0;
  v_divs_imported     integer := 0;
  v_ticker            text;
BEGIN
  SELECT COALESCE(cash_balance, 0) INTO v_previous_cash
  FROM portfolios WHERE id = p_portfolio_id;

  INSERT INTO imports (
    portfolio_id, broker, filename, trade_count, summary,
    status, imported_at, rollback_data, user_id
  ) VALUES (
    p_portfolio_id, p_broker, p_filename,
    jsonb_array_length(p_trades),
    p_summary,
    'active', now(),
    jsonb_build_object('previous_cash_balance', v_previous_cash),
    p_user_id
  )
  RETURNING id INTO v_import_id;

  FOR v_trade IN SELECT * FROM jsonb_array_elements(p_trades)
  LOOP
    v_ticker := v_trade->>'symbol';

    INSERT INTO positions (ticker, name, type, portfolio_id)
    VALUES (v_ticker, v_ticker, 'stock', p_portfolio_id)
    ON CONFLICT (ticker, portfolio_id) DO NOTHING;

    SELECT id INTO v_position_id FROM positions
    WHERE ticker = v_ticker AND portfolio_id = p_portfolio_id
    LIMIT 1;

    IF v_position_id IS NULL THEN
      RAISE EXCEPTION 'Position not found for ticker % in portfolio %', v_ticker, p_portfolio_id;
    END IF;

    INSERT INTO trades (
      position_id, type, price, quantity, date,
      commission, currency, import_id, notes
    ) VALUES (
      v_position_id,
      v_trade->>'type',
      (v_trade->>'price')::numeric,
      (v_trade->>'quantity')::numeric,
      (v_trade->>'date')::date,
      COALESCE((v_trade->>'commission')::numeric, 0),
      COALESCE(v_trade->>'currency', 'USD'),
      v_import_id,
      'IBKR import'
    )
    RETURNING id INTO v_trade_id;

    INSERT INTO import_rows (
      import_id, row_type, status, normalized_data,
      created_record_id, created_record_type
    ) VALUES (
      v_import_id, 'trade', 'imported', v_trade,
      v_trade_id, 'trade'
    );

    v_trades_imported := v_trades_imported + 1;
  END LOOP;

  FOR v_dividend IN SELECT * FROM jsonb_array_elements(p_dividends)
  LOOP
    INSERT INTO dividends (
      ticker, amount, date, portfolio_id, currency, notes
    ) VALUES (
      v_dividend->>'ticker',
      (v_dividend->>'amount')::numeric,
      (v_dividend->>'date')::date,
      p_portfolio_id,
      COALESCE(v_dividend->>'currency', 'USD'),
      COALESCE(v_dividend->>'description', 'IBKR import')
    )
    RETURNING id INTO v_dividend_id;

    INSERT INTO import_rows (
      import_id, row_type, status, normalized_data,
      created_record_id, created_record_type
    ) VALUES (
      v_import_id, 'dividend', 'imported', v_dividend,
      v_dividend_id, 'dividend'
    );

    v_divs_imported := v_divs_imported + 1;
  END LOOP;

  IF p_ending_cash IS NOT NULL THEN
    INSERT INTO cash_adjustments (
      portfolio_id, previous_balance, new_balance, date, notes
    ) VALUES (
      p_portfolio_id, v_previous_cash, p_ending_cash,
      CURRENT_DATE,
      'IBKR import — ' || p_filename
    );
    UPDATE portfolios SET cash_balance = p_ending_cash WHERE id = p_portfolio_id;
  END IF;

  RETURN jsonb_build_object(
    'importId',          v_import_id,
    'tradesImported',    v_trades_imported,
    'dividendsImported', v_divs_imported
  );
END;
$$;
