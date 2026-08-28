-- 0005: seed two real department templates (Engineering, Finance),
-- each at version 1 / is_active = true. Per Step 10, templates are
-- immutable once published — a future edit means TemplatesService
-- .createNewVersion() inserting a fresh version row, never an UPDATE
-- of the rows below.
--
-- Each template carries exactly one is_checkpoint = true task — the
-- laptop/equipment handover — modeling the BRD's "handovers need two
-- parties" rule (dual confirmation, neither side can close it alone).
-- Synthetic data only, per the BRD.

WITH engineering_template AS (
  INSERT INTO onboarding_templates (department_id, name, version, is_active)
  SELECT id, 'Engineering Onboarding', 1, true
  FROM departments WHERE name = 'Engineering'
  RETURNING id
)
INSERT INTO template_tasks (
  template_id, title, description, owner_role, due_offset_days,
  priority, is_required, completion_mode, is_checkpoint, milestone
)
SELECT engineering_template.id, t.title, t.description, t.owner_role,
       t.due_offset_days, t.priority, t.is_required, t.completion_mode,
       t.is_checkpoint, t.milestone
FROM engineering_template, (VALUES
  ('Read the Engineering onboarding guide',
   'Skim the public knowledge base articles for your team before day 1.',
   'employee', 0, 'normal', true, 'employee', false, 'Day 1'),
  ('Laptop & dev environment handover',
   'IT hands over a provisioned laptop; you confirm receipt and that it boots.',
   'task_owner', 0, 'high', true, 'dual', true, 'Day 1'),
  ('Grant repo & CI/CD access',
   'Add to the GitHub org, CI pipelines, and staging environment.',
   'task_owner', 1, 'high', true, 'owner', false, 'Day 1'),
  ('Meet your onboarding buddy',
   'Introductory call with your assigned buddy.',
   'task_owner', 2, 'normal', true, 'dual', false, 'Week 1'),
  ('Complete security & code-of-conduct training',
   'Mandatory training module, self-paced.',
   'employee', 3, 'normal', true, 'employee', false, 'Week 1'),
  ('Ship first small PR',
   'Pick a starter-labeled ticket and get it merged.',
   'employee', 10, 'normal', true, 'employee', false, 'Week 2'),
  ('30-day check-in with manager',
   'Structured 1:1 covering ramp-up progress.',
   'task_owner', 30, 'normal', true, 'dual', false, 'Month 1')
) AS t(title, description, owner_role, due_offset_days, priority,
       is_required, completion_mode, is_checkpoint, milestone);


WITH finance_template AS (
  INSERT INTO onboarding_templates (department_id, name, version, is_active)
  SELECT id, 'Finance Onboarding', 1, true
  FROM departments WHERE name = 'Finance'
  RETURNING id
)
INSERT INTO template_tasks (
  template_id, title, description, owner_role, due_offset_days,
  priority, is_required, completion_mode, is_checkpoint, milestone
)
SELECT finance_template.id, t.title, t.description, t.owner_role,
       t.due_offset_days, t.priority, t.is_required, t.completion_mode,
       t.is_checkpoint, t.milestone
FROM finance_template, (VALUES
  ('Read the Finance onboarding guide',
   'Skim the public knowledge base articles for your team before day 1.',
   'employee', 0, 'normal', true, 'employee', false, 'Day 1'),
  ('Laptop & access card handover',
   'IT/admin hands over a provisioned laptop and building access card; you confirm receipt.',
   'task_owner', 0, 'high', true, 'dual', true, 'Day 1'),
  ('Set up payroll & banking details',
   'Submit bank details and tax declarations via the HR portal.',
   'employee', 1, 'high', true, 'employee', false, 'Day 1'),
  ('Grant ERP/accounting system access',
   'Provision access to the accounting system and shared drives.',
   'task_owner', 1, 'high', true, 'owner', false, 'Day 1'),
  ('Complete compliance & confidentiality training',
   'Mandatory training module covering financial confidentiality.',
   'employee', 3, 'normal', true, 'employee', false, 'Week 1'),
  ('Shadow month-end close process',
   'Observe one full month-end close cycle with a senior teammate.',
   'task_owner', 15, 'normal', true, 'dual', false, 'Month 1'),
  ('30-day check-in with manager',
   'Structured 1:1 covering ramp-up progress.',
   'task_owner', 30, 'normal', true, 'dual', false, 'Month 1')
) AS t(title, description, owner_role, due_offset_days, priority,
       is_required, completion_mode, is_checkpoint, milestone);
