-- 0002: core schema.
-- Plain SQL, no ORM schema DSL. Every invariant that CAN be enforced by
-- Postgres itself (not just application code) is written as a
-- constraint/CHECK here, per the "authorization/enforcement is
-- server-side" rule — and a CHECK constraint is even more server-side
-- than a service-layer if-statement, since it holds even if a future
-- endpoint forgets to check.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- Reusable trigger: keeps updated_at accurate without trusting the
-- application to remember to set it on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- USERS
-- temp_login_email: system-generated, permanent login identifier.
-- company_email: informational until company_email_active flips true
--   on first successful company-email login (the "bridge" login rule
--   we agreed on — nobody gets locked out mid-switch).
-- must_reset_password: set true the moment company_email is recorded;
--   checked at that first company-email login to force a fresh
--   password choice.
-- No personal email is ever stored, by design.
-- ============================================================
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             TEXT NOT NULL,
  phone_number          TEXT NOT NULL,

  temp_login_email      TEXT NOT NULL UNIQUE,
  company_email         TEXT UNIQUE,
  company_email_active  BOOLEAN NOT NULL DEFAULT false,
  must_reset_password   BOOLEAN NOT NULL DEFAULT false,

  password_hash         TEXT NOT NULL,
  totp_secret           TEXT,
  totp_enrolled_at      TIMESTAMPTZ,

  role                  TEXT NOT NULL CHECK (role IN ('superadmin_hr', 'task_owner', 'employee')),
  department_id         UUID REFERENCES departments(id),

  status                TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  deleted_at            TIMESTAMPTZ, -- soft delete only, never a real DELETE

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_users_department ON users(department_id);


-- ============================================================
-- ONBOARDING TEMPLATES
-- Editing a template NEVER mutates a row here — a change is always a
-- new row with version = old.version + 1. Old versions stay forever
-- (never deleted) purely so onboardings already pointing at them keep
-- meaning. There is no UPDATE path for template_tasks content in the
-- application at all — only INSERT of a new version.
-- ============================================================
CREATE TABLE onboarding_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id),
  name          TEXT NOT NULL,
  version       INT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true, -- only the latest version is offered for NEW onboardings
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name, version)
);

CREATE TABLE template_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      UUID NOT NULL REFERENCES onboarding_templates(id),
  title            TEXT NOT NULL,
  description      TEXT,
  owner_role       TEXT NOT NULL,
  due_offset_days  INT NOT NULL DEFAULT 0,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  is_required      BOOLEAN NOT NULL DEFAULT true,
  completion_mode  TEXT NOT NULL CHECK (completion_mode IN ('employee', 'owner', 'dual')),
  is_checkpoint    BOOLEAN NOT NULL DEFAULT false, -- marks the laptop-handover task in the template
  milestone        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_template_tasks_template ON template_tasks(template_id);


-- ============================================================
-- ONBOARDINGS
-- ============================================================
CREATE TABLE onboardings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id), -- one onboarding per user
  department_id     UUID NOT NULL REFERENCES departments(id),
  template_id       UUID NOT NULL REFERENCES onboarding_templates(id),
  template_version  INT NOT NULL, -- frozen at instantiation time, informational + traceability
  start_date        DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pre_onboarding'
                      CHECK (status IN ('pre_onboarding', 'email_provisioned', 'checkpoint_pending', 'active', 'completed', 'cancelled')),
  cancel_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_onboardings_updated_at
  BEFORE UPDATE ON onboardings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_onboardings_department_status ON onboardings(department_id, status);


-- ============================================================
-- ONBOARDING TASKS — the SNAPSHOT.
-- source_template_task_id is kept ONLY for "which template task did
-- this come from" traceability in the UI/audit trail. No query path
-- in the app ever joins back to template_tasks to determine a live
-- task's title/owner/due-date/etc — every field below is copied at
-- instantiation time. This is *why* a template edit can never reach
-- a running onboarding: there is no live reference to break.
--
-- The dual-confirmation rule is enforced by the CHECK constraint
-- below, not just application code — a dual-mode task literally
-- cannot be written to the DB as 'completed' unless both confirmation
-- timestamps are already set, regardless of what any endpoint does.
-- ============================================================
CREATE TABLE onboarding_tasks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id            UUID NOT NULL REFERENCES onboardings(id),
  source_template_task_id  UUID REFERENCES template_tasks(id), -- traceability only

  title            TEXT NOT NULL,
  description      TEXT,
  owner_role       TEXT NOT NULL,
  owner_user_id    UUID REFERENCES users(id),
  due_date         DATE NOT NULL,
  priority         TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
  is_required      BOOLEAN NOT NULL,
  completion_mode  TEXT NOT NULL CHECK (completion_mode IN ('employee', 'owner', 'dual')),
  is_checkpoint    BOOLEAN NOT NULL DEFAULT false,

  status           TEXT NOT NULL DEFAULT 'locked'
                     CHECK (status IN ('locked', 'pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
  blocked_reason   TEXT,
  cancel_reason    TEXT,

  employee_confirmed_by  UUID REFERENCES users(id),
  employee_confirmed_at  TIMESTAMPTZ,
  owner_confirmed_by     UUID REFERENCES users(id),
  owner_confirmed_at     TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dual-confirmation cannot reach 'completed' via one actor.
  CONSTRAINT chk_dual_confirmation CHECK (
    completion_mode <> 'dual'
    OR status <> 'completed'
    OR (employee_confirmed_at IS NOT NULL AND owner_confirmed_at IS NOT NULL)
  )
);

CREATE TRIGGER trg_onboarding_tasks_updated_at
  BEFORE UPDATE ON onboarding_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_onboarding_tasks_onboarding ON onboarding_tasks(onboarding_id);
CREATE INDEX idx_onboarding_tasks_owner ON onboarding_tasks(owner_user_id); -- backs "owner_id = self" scoping
CREATE INDEX idx_onboarding_tasks_due_date ON onboarding_tasks(due_date); -- backs overdue detection

CREATE TABLE task_dependencies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID NOT NULL REFERENCES onboarding_tasks(id),
  depends_on_task_id  UUID NOT NULL REFERENCES onboarding_tasks(id),
  CHECK (task_id <> depends_on_task_id),
  UNIQUE (task_id, depends_on_task_id)
);


-- ============================================================
-- ENTITLEMENTS
-- available_quantity is decremented inside the transaction built in
-- Step 22 using SELECT ... FOR UPDATE on this row, so two concurrent
-- claims physically cannot both read the same "1 remaining" value.
-- NULL total_quantity/available_quantity = unlimited (e.g. learning budget).
-- ============================================================
CREATE TABLE entitlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  scope               TEXT NOT NULL CHECK (scope IN ('company_wide', 'department')),
  department_id       UUID REFERENCES departments(id),
  total_quantity      INT,
  available_quantity  INT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (scope = 'department' AND department_id IS NOT NULL)
    OR (scope = 'company_wide' AND department_id IS NULL)
  ),
  CHECK (available_quantity IS NULL OR available_quantity >= 0)
);

CREATE TABLE entitlement_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES entitlements(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'revoked')),
  claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  revoke_reason  TEXT,
  UNIQUE (entitlement_id, user_id) -- one claim per user per entitlement
);


-- ============================================================
-- NOTES — private, absolutely.
-- No column here supports a "view as user" or admin-override path.
-- The isolation guarantee comes from the fact that every query in
-- the NotesModule is hand-written with `WHERE user_id = $1` bound to
-- the authenticated requester — there is no parameter, flag, or admin
-- role check anywhere in that code path that can widen it. This table
-- is deliberately never joined into any report/export/search query.
-- ============================================================
CREATE TABLE notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notes_user ON notes(user_id);


-- ============================================================
-- ACTIVITY LOG — append-only.
-- No application code path issues UPDATE/DELETE against this table.
-- For real enforcement (not just discipline), once you provision a
-- separate runtime DB role for the running app (distinct from the
-- migration role), run:
--   REVOKE UPDATE, DELETE ON activity_logs FROM <app_runtime_role>;
-- so even a bug or a compromised app process cannot alter history.
-- Never logs note content, password hashes, or TOTP secrets.
-- ============================================================
CREATE TABLE activity_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id), -- NULL for system-initiated actions
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_logs_actor ON activity_logs(actor_id);


-- ============================================================
-- KNOWLEDGE BASE
-- visibility: 'public' (no auth), 'pre_email_auth' (claimed account,
-- pre-checkpoint), 'post_checkpoint' (full employee access). Reading
-- these rows never touches onboarding_tasks or progress — enforced
-- simply by there being no code path that writes to onboarding_tasks
-- from the KnowledgeModule at all.
-- ============================================================
CREATE TABLE knowledge_categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE knowledge_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES knowledge_categories(id),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  department_id UUID REFERENCES departments(id), -- NULL = company-wide
  visibility    TEXT NOT NULL CHECK (visibility IN ('public', 'pre_email_auth', 'post_checkpoint')),
  is_published  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_knowledge_articles_updated_at
  BEFORE UPDATE ON knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_knowledge_articles_dept_visibility ON knowledge_articles(department_id, visibility);


-- ============================================================
-- COMMUNITY
-- author_id/deleted_by are stored for moderation traceability but the
-- API layer never serializes author_id back to anyone but the author
-- themself. Vote counts are computed on read from community_votes
-- (COUNT ... FILTER), never stored as a column — same "never let a
-- derived number drift from its source rows" rule as onboarding progress.
-- ============================================================
CREATE TABLE community_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     UUID NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES users(id),
  delete_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_community_posts_created ON community_posts(created_at DESC);

CREATE TABLE community_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES community_posts(id),
  author_id  UUID NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_community_comments_post ON community_comments(post_id);

CREATE TABLE community_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES community_posts(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  value      SMALLINT NOT NULL CHECK (value IN (1, -1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id) -- one vote per user per post; a changed vote is an UPDATE of this row
);


-- ============================================================
-- DOCUMENTS
-- ============================================================
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  department_id UUID REFERENCES departments(id), -- NULL = company-wide
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_department ON documents(department_id);
