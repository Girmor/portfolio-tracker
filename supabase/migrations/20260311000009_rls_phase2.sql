-- Migration 9: Upgrade RLS to proper auth.uid() checks (Phase 2)
-- Run AFTER claiming existing data:
--   UPDATE portfolios SET user_id = auth.uid() WHERE user_id IS NULL;
--   UPDATE imports    SET user_id = auth.uid() WHERE user_id IS NULL;

-- ─── portfolios ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON portfolios;

CREATE POLICY "portfolios_select" ON portfolios FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "portfolios_insert" ON portfolios FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "portfolios_update" ON portfolios FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "portfolios_delete" ON portfolios FOR DELETE
  USING (user_id = auth.uid());

-- ─── imports ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON imports;

CREATE POLICY "imports_select" ON imports FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "imports_insert" ON imports FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "imports_update" ON imports FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "imports_delete" ON imports FOR DELETE
  USING (user_id = auth.uid());

-- ─── positions (via portfolios) ───────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON positions;

CREATE POLICY "positions_all" ON positions FOR ALL
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  )
  WITH CHECK (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

-- ─── trades (via positions → portfolios) ─────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON trades;

CREATE POLICY "trades_all" ON trades FOR ALL
  USING (
    position_id IN (
      SELECT p.id FROM positions p
      JOIN portfolios pf ON pf.id = p.portfolio_id
      WHERE pf.user_id = auth.uid()
    )
  )
  WITH CHECK (
    position_id IN (
      SELECT p.id FROM positions p
      JOIN portfolios pf ON pf.id = p.portfolio_id
      WHERE pf.user_id = auth.uid()
    )
  );

-- ─── dividends (via portfolio_id) ────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON dividends;

CREATE POLICY "dividends_all" ON dividends FOR ALL
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  )
  WITH CHECK (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

-- ─── snapshots — no portfolio_id column; allow any authenticated user ─────────
DROP POLICY IF EXISTS "allow_all_phase1" ON snapshots;

CREATE POLICY "snapshots_all" ON snapshots FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ─── budget — no portfolio_id column; allow any authenticated user ─────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON budget;

CREATE POLICY "budget_all" ON budget FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ─── cash_adjustments (via portfolio_id) ─────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON cash_adjustments;

CREATE POLICY "cash_adjustments_all" ON cash_adjustments FOR ALL
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  )
  WITH CHECK (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

-- ─── import_rows (via imports) ────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON import_rows;

CREATE POLICY "import_rows_all" ON import_rows FOR ALL
  USING (
    import_id IN (SELECT id FROM imports WHERE user_id = auth.uid())
  )
  WITH CHECK (
    import_id IN (SELECT id FROM imports WHERE user_id = auth.uid())
  );

-- ─── assets — read-only for all authenticated users (global/shared data) ──────
DROP POLICY IF EXISTS "allow_all_phase1" ON assets;

CREATE POLICY "assets_read" ON assets FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Allow the service role to insert/update assets (price enrichment)
CREATE POLICY "assets_write_service" ON assets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─── price_cache — read-only for all authenticated users ─────────────────────
DROP POLICY IF EXISTS "allow_all_phase1" ON price_cache;

CREATE POLICY "price_cache_read" ON price_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "price_cache_write_service" ON price_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
