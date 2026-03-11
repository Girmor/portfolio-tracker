-- Migration 3: Create import_rows table for per-row import tracking

CREATE TABLE IF NOT EXISTS import_rows (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id            uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number           integer,
  row_type             text CHECK (row_type IN ('trade', 'dividend', 'tax', 'cash')),
  status               text DEFAULT 'imported' CHECK (status IN ('pending', 'imported', 'duplicate', 'error', 'skipped')),
  raw_data             jsonb,
  normalized_data      jsonb,
  error_message        text,
  created_record_id    uuid,
  created_record_type  text,
  created_at           timestamptz DEFAULT now()
);
