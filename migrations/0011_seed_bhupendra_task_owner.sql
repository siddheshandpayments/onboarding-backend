-- Seeds a stable, named IT/task_owner account — the person company-
-- email/laptop-handover tasks get auto-assigned to (see
-- OnboardingsService.provisionCompanyEmail's auto-claim step). Same
-- pgcrypto pattern as 0004's bootstrap superadmin, same reason: a
-- fixed, reusable test login rather than one generated per test run.
--
-- Login: temp_login_email below, password 'Bhupendra123'. Dev/seed
-- data only. Goes through the normal forced-reset + TOTP flow on
-- first login, same as any account.

INSERT INTO users (
  full_name, phone_number,
  temp_login_email, password_hash,
  role, department_id,
  status, must_reset_password
) VALUES (
  'Bhupendra', '+10000000002',
  'bhupendra@id.onboarding.internal',
  crypt('Bhupendra123', gen_salt('bf', 12)),
  'task_owner', NULL,
  'invited', true
);
