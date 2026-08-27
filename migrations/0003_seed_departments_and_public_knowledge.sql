-- 0003: seed data. Departments + a couple of PUBLIC knowledge
-- articles, so there's something real to hit once auth (Step 1
-- follow-through) and the knowledge endpoints (Step 2, later) exist.
-- Synthetic data only, per the BRD.

INSERT INTO departments (name) VALUES
  ('Engineering'),
  ('Finance'),
  ('Operations');

INSERT INTO knowledge_categories (name) VALUES
  ('Office Guide'),
  ('Mac & Laptop Basics'),
  ('FAQ');

INSERT INTO knowledge_articles (category_id, title, content, department_id, visibility, is_published)
SELECT
  (SELECT id FROM knowledge_categories WHERE name = 'Office Guide'),
  'Pantry, water & washrooms',
  'The pantry, drinking water, and washrooms are all on the 3rd floor.',
  NULL:: uuid,
  'public',
  true
UNION ALL
SELECT
  (SELECT id FROM knowledge_categories WHERE name = 'Office Guide'),
  'Lunch',
  'Lunch is typically taken around 2 PM and should be concluded within 45 minutes. Meal coupons are available; using them is optional.',
  NULL::uuid,
  'public',
  true
UNION ALL
SELECT
  (SELECT id FROM knowledge_categories WHERE name = 'Office Guide'),
  'Recreation',
  'Recreational/sports facilities are available after office hours, and during permitted hours on Friday.',
  NULL::uuid,
  'public',
  true;
