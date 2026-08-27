-- 0001: connection sanity check.
-- Real schema (departments, users, templates, tasks, etc.) is Step 2.
-- This file's only job is to prove DATABASE_URL + the migration
-- runner work end to end before anything real is built on top.

CREATE TABLE IF NOT EXISTS _bootstrap_check (
  id SERIAL PRIMARY KEY,
  note TEXT NOT NULL DEFAULT 'db connection verified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
