-- Migration 6: Row-Level Security — Phase 1 permissive policies
-- These allow all operations until Phase 2 adds auth.uid() checks.

ALTER TABLE portfolios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends     ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows   ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_adjustments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'budget' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE budget ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Permissive "allow all" policies for Phase 1 (replaced in Phase 2)
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON portfolios    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON positions     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON trades        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON dividends     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON imports       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON import_rows   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON snapshots     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON assets        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON price_cache   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all_phase1" ON cash_adjustments FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'budget' AND table_schema = 'public') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budget' AND policyname = 'allow_all_phase1') THEN
      EXECUTE 'CREATE POLICY "allow_all_phase1" ON budget FOR ALL USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;
