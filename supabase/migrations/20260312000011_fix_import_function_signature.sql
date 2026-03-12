-- Migration 11: Fix overloaded commit_ibkr_import function
--
-- Migration 10 used CREATE OR REPLACE with a different parameter count (8 vs 7).
-- Postgres treats that as a NEW overload, leaving two functions with the same name.
-- PostgREST cannot resolve the ambiguous call → edge function returns 500.
--
-- Fix: drop the original 7-parameter version, keep the 8-parameter one.

DROP FUNCTION IF EXISTS commit_ibkr_import(
  uuid, text, text, jsonb, jsonb, numeric, jsonb
);
