-- 0014: employee diary — a private, per-day journal entry, visible
-- only to the employee who wrote it. Same isolation guarantee as the
-- notes table: every query in DiaryModule is hand-written with
-- `WHERE user_id = $1` bound to the authenticated requester, and this
-- table is never joined into any admin/report/export query.

CREATE TABLE diary_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  entry_date DATE NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_date) -- one entry per employee per day; editing today just updates it
);

CREATE TRIGGER trg_diary_entries_updated_at
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_diary_entries_user ON diary_entries(user_id);
