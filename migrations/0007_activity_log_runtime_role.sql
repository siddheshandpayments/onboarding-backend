-- 0007: DB-level enforcement for Step 27's append-only activity_logs
-- requirement. Application code (ActivityLogService) never issues
-- UPDATE/DELETE against this table — but that's discipline, not
-- enforcement, per the comment already left on this table back in
-- 0002_core_schema.sql: a bug or a compromised app process could still
-- do it. This migration is what makes it actually impossible: a
-- restricted role that can read/write everything the app needs,
-- except UPDATE/DELETE on activity_logs specifically.
--
-- This does NOT change what role the app connects as today —
-- DATABASE_URL keeps using whatever role you already configured, so
-- local dev is unaffected by running this migration. To actually get
-- the enforcement, set a password for this role and point DATABASE_URL
-- at it instead:
--   ALTER ROLE app_runtime WITH PASSWORD '<set via your secrets manager, never committed>';
-- Whatever role runs migrations (this file included) must keep
-- superuser/owner privileges, since only it ever runs DDL —
-- app_runtime deliberately cannot.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;

-- Everything the app actually does at runtime: read/write rows, never
-- DDL (no CREATE/ALTER/DROP grant exists for app_runtime at all).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- The one deliberate carve-out: activity_logs is INSERT/SELECT only.
REVOKE UPDATE, DELETE ON activity_logs FROM app_runtime;

-- ALTER DEFAULT PRIVILEGES only affects objects created AFTER this
-- runs, by whichever role executes it — not retroactive. A future
-- migration that adds a table will need app_runtime granted on it
-- explicitly (or re-run this pattern) if it should also carry a
-- carve-out; this isn't automated further than the default grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
