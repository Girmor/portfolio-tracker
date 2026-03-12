-- Migration 12: Completely rebuild commit_ibkr_import
--
-- Previous migrations may have left multiple overloads. This drops ALL
-- versions by iterating pg_proc, then recreates the single canonical version.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc
    WHERE proname = 'commit_ibkr_import'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

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
  -- Get current cash balance
  SELECT COALESCE(cash_balance, 0) INTO v_previous_cash
  FROM portfolios WHERE id = p_portfolio_id;

  -- Create import record
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

  -- Process trades
  FOR v_trade IN SELECT * FROM jsonb_array_elements(p_trades)
  LOOP
    v_ticker := v_trade->>'symbol';

    -- Upsert position (silently skip if already exists)
    INSERT INTO positions (ticker, name, type, portfolio_id)
    VALUES (v_ticker, v_ticker, 'stock', p_portfolio_id)
    ON CONFLICT (ticker, portfolio_id) DO NOTHING;

    SELECT id INTO v_position_id FROM positions
    WHERE ticker = v_ticker AND portfolio_id = p_portfolio_id
    LIMIT 1;

    IF v_position_id IS NULL THEN
      RAISE EXCEPTION 'Position not found for ticker % in portfolio %', v_ticker, p_portfolio_id;
    END IF;

    -- Insert trade
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

    -- Record import row
    INSERT INTO import_rows (
      import_id, row_type, status, normalized_data,
      created_record_id, created_record_type
    ) VALUES (
      v_import_id, 'trade', 'imported', v_trade,
      v_trade_id, 'trade'
    );

    v_trades_imported := v_trades_imported + 1;
  END LOOP;

  -- Process dividends
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

  -- Update cash balance if provided
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
