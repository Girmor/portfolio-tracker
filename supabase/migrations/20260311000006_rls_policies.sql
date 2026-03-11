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

-- Drop existing policies if any, then recreate
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['portfolios','positions','trades','dividends','imports','import_rows','snapshots','assets','price_cache','cash_adjustments']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_phase1" ON %I', tbl);
    EXECUTE format('CREATE POLICY "allow_all_phase1" ON %I FOR ALL USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'budget' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS "allow_all_phase1" ON budget';
    EXECUTE 'CREATE POLICY "allow_all_phase1" ON budget FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;
