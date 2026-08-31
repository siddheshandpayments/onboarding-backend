-- Replaces the Engineering/Finance templates with a new version, and
-- gives Operations a template for the first time — all three sharing
-- the same first two tasks and the same checkpoint (read the docs,
-- meet your reporting manager, company email & laptop handover), and
-- diverging only in the post-checkpoint app-install checklist, per
-- the department-specific instruction: "the first task should be
-- same for everyone but when they get their email the tasks then
-- become with respect to department." The old Engineering/Finance
-- template rows are untouched (TemplatesService.createNewVersion's
-- own rule) — only new is_active=true versions are added.

UPDATE onboarding_templates SET is_active = false
WHERE name IN ('Engineering Onboarding', 'Finance Onboarding') AND is_active = true;

WITH engineering_template AS (
  INSERT INTO onboarding_templates (department_id, name, version, is_active)
  SELECT id, 'Engineering Onboarding', 2, true
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
  ('Read the docs',
   'Read the Employee Handbook, Meal Reimbursement Policy, Domestic Travel Policy, and Group Health Insurance policy — all available on the Documents page, same four for every department.',
   'employee', 0, 'normal', true, 'employee', false, 'Day 1'),
  ('Meet your reporting manager',
   'Introductory call or meeting with your reporting manager.',
   'task_owner', 0, 'normal', true, 'dual', false, 'Day 1'),
  ('Company email & laptop handover',
   'IT hands over a provisioned laptop and your official company email; you confirm receipt and that both work.',
   'task_owner', 0, 'high', true, 'dual', true, 'Day 1'),
  ('Meet your onboarding buddy',
   'Introductory call with your assigned buddy.',
   'task_owner', 2, 'normal', true, 'dual', false, 'Week 1'),
  ('Install Microsoft apps',
   'Install Word, Excel, Outlook, and Teams, signed in with your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install VS Code',
   'Install Visual Studio Code, signed in with your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install GitHub',
   'Install GitHub Desktop (or the CLI) and join the org, using your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install a Postgres GUI',
   'Install a Postgres client of your choice (pgAdmin, TablePlus, or DBeaver), configured with your official company email where the tool asks for one.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install Claude',
   'Install Claude (desktop app or browser), signed in with your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Register for office entry & exit access',
   'Facilities registers your badge/biometric access for entering and exiting the office.',
   'task_owner', 3, 'normal', true, 'owner', false, 'Week 1')
) AS t(title, description, owner_role, due_offset_days, priority,
       is_required, completion_mode, is_checkpoint, milestone);


WITH finance_template AS (
  INSERT INTO onboarding_templates (department_id, name, version, is_active)
  SELECT id, 'Finance Onboarding', 2, true
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
  ('Read the docs',
   'Read the Employee Handbook, Meal Reimbursement Policy, Domestic Travel Policy, and Group Health Insurance policy — all available on the Documents page, same four for every department.',
   'employee', 0, 'normal', true, 'employee', false, 'Day 1'),
  ('Meet your reporting manager',
   'Introductory call or meeting with your reporting manager.',
   'task_owner', 0, 'normal', true, 'dual', false, 'Day 1'),
  ('Company email & laptop handover',
   'IT hands over a provisioned laptop and your official company email; you confirm receipt and that both work.',
   'task_owner', 0, 'high', true, 'dual', true, 'Day 1'),
  ('Meet your onboarding buddy',
   'Introductory call with your assigned buddy.',
   'task_owner', 2, 'normal', true, 'dual', false, 'Week 1'),
  ('Install Microsoft apps',
   'Install Word, Excel, Outlook, and Teams, signed in with your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install your accounting system',
   'Install/access your team''s accounting or ERP tool (e.g. Zoho Books or Tally — confirm the exact system with your manager), using your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install Claude',
   'Install Claude (desktop app or browser), signed in with your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Register for office entry & exit access',
   'Facilities registers your badge/biometric access for entering and exiting the office.',
   'task_owner', 3, 'normal', true, 'owner', false, 'Week 1')
) AS t(title, description, owner_role, due_offset_days, priority,
       is_required, completion_mode, is_checkpoint, milestone);


WITH operations_template AS (
  INSERT INTO onboarding_templates (department_id, name, version, is_active)
  SELECT id, 'Operations Onboarding', 1, true
  FROM departments WHERE name = 'Operations'
  RETURNING id
)
INSERT INTO template_tasks (
  template_id, title, description, owner_role, due_offset_days,
  priority, is_required, completion_mode, is_checkpoint, milestone
)
SELECT operations_template.id, t.title, t.description, t.owner_role,
       t.due_offset_days, t.priority, t.is_required, t.completion_mode,
       t.is_checkpoint, t.milestone
FROM operations_template, (VALUES
  ('Read the docs',
   'Read the Employee Handbook, Meal Reimbursement Policy, Domestic Travel Policy, and Group Health Insurance policy — all available on the Documents page, same four for every department.',
   'employee', 0, 'normal', true, 'employee', false, 'Day 1'),
  ('Meet your reporting manager',
   'Introductory call or meeting with your reporting manager.',
   'task_owner', 0, 'normal', true, 'dual', false, 'Day 1'),
  ('Company email & laptop handover',
   'IT hands over a provisioned laptop and your official company email; you confirm receipt and that both work.',
   'task_owner', 0, 'high', true, 'dual', true, 'Day 1'),
  ('Meet your onboarding buddy',
   'Introductory call with your assigned buddy.',
   'task_owner', 2, 'normal', true, 'dual', false, 'Week 1'),
  ('Install Microsoft apps',
   'Install Word, Excel, Outlook, and Teams, signed in with your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install your ops scheduling tool',
   'Install/access your team''s scheduling or ticketing tool (confirm the exact system with your manager), using your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Install Claude',
   'Install Claude (desktop app or browser), signed in with your official company email.',
   'employee', 2, 'normal', true, 'employee', false, 'Week 1'),
  ('Register for office entry & exit access',
   'Facilities registers your badge/biometric access for entering and exiting the office.',
   'task_owner', 3, 'normal', true, 'owner', false, 'Week 1')
) AS t(title, description, owner_role, due_offset_days, priority,
       is_required, completion_mode, is_checkpoint, milestone);
