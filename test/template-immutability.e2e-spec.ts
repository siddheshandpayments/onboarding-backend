import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { DatabaseService } from '../src/database/database.service';

// Same fallback env pattern as rbac.e2e-spec.ts.
// This suite performs real writes, so use a disposable/dev database.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * The core BRD guarantee:
 *
 * Editing a department's template must never modify an onboarding
 * that has already been instantiated from that template.
 *
 * Everything this suite creates is removed in afterAll().
 */
describe('Template immutability (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  let superadminToken: string;
  let superadminId: string;

  let engineeringDeptId: string;
  let originalActiveTemplateId: string;

  let newTemplateVersionId: string | undefined;
  let createdUserId: string | undefined;
  let createdOnboardingId: string | undefined;

  beforeAll(async () => {
    const moduleRef: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    db = moduleRef.get(DatabaseService);
    const tokens = moduleRef.get(TokenService);

    // ------------------------------------------------------------
    // IMPORTANT:
    // We MUST use a real SuperAdmin user here.
    //
    // RolesGuard only checks the token role, but AuthService also
    // writes an activity_log using actorId. activity_logs.actor_id
    // has a foreign-key constraint to users.id.
    // ------------------------------------------------------------

    const { rows: adminRows } = await db.query<{
      id: string;
      full_name: string;
      role: string;
    }>(
      `SELECT id, full_name, role
       FROM users
       WHERE role = 'superadmin_hr'
         AND deleted_at IS NULL
         AND status != 'disabled'
       ORDER BY created_at
       LIMIT 1`,
    );

    if (!adminRows[0]) {
      throw new Error(
        'No active superadmin_hr user found. Create a SuperAdmin user before running this test.',
      );
    }

    superadminId = adminRows[0].id;

    // Sign the token using the REAL database user ID.
    superadminToken = tokens.signAccessToken({
      id: superadminId,
      role: 'superadmin_hr',
    });

    // ------------------------------------------------------------
    // Find Engineering department
    // ------------------------------------------------------------

    const { rows: deptRows } = await db.query<{ id: string }>(
      `SELECT id
       FROM departments
       WHERE name = 'Engineering'
       LIMIT 1`,
    );

    if (!deptRows[0]) {
      throw new Error(
        'Engineering department not found — run migrations (0003) against this DATABASE_URL first.',
      );
    }

    engineeringDeptId = deptRows[0].id;

    // ------------------------------------------------------------
    // Find the current active Engineering template
    // ------------------------------------------------------------

    const { rows: activeRows } = await db.query<{ id: string }>(
      `SELECT id
       FROM onboarding_templates
       WHERE department_id = $1
         AND is_active = true
       LIMIT 1`,
      [engineeringDeptId],
    );

    if (!activeRows[0]) {
      throw new Error(
        'No active Engineering template — run migrations (0005) against this DATABASE_URL first.',
      );
    }

    originalActiveTemplateId = activeRows[0].id;
  });

  afterAll(async () => {
    // ------------------------------------------------------------
    // Delete onboarding tasks first because they reference
    // onboardings.
    // ------------------------------------------------------------

    if (createdOnboardingId) {
      await db.query(
        `DELETE FROM onboarding_tasks
         WHERE onboarding_id = $1`,
        [createdOnboardingId],
      );

      await db.query(
        `DELETE FROM onboardings
         WHERE id = $1`,
        [createdOnboardingId],
      );
    }

    // ------------------------------------------------------------
    // Delete the test employee.
    //
    // This is safe because the activity_logs created during this
    // test use superadminId as actor_id, NOT createdUserId.
    // ------------------------------------------------------------

    if (createdUserId) {
      await db.query(
        `DELETE FROM users
         WHERE id = $1`,
        [createdUserId],
      );
    }

    // ------------------------------------------------------------
    // Delete the new template version's tasks first.
    // ------------------------------------------------------------

    if (newTemplateVersionId) {
      await db.query(
        `DELETE FROM template_tasks
         WHERE template_id = $1`,
        [newTemplateVersionId],
      );

      await db.query(
        `DELETE FROM onboarding_templates
         WHERE id = $1`,
        [newTemplateVersionId],
      );
    }

    // ------------------------------------------------------------
    // Restore the original template as active.
    // ------------------------------------------------------------

    if (originalActiveTemplateId) {
      await db.query(
        `UPDATE onboarding_templates
         SET is_active = true
         WHERE id = $1`,
        [originalActiveTemplateId],
      );
    }

    if (app) {
      await app.close();
    }
  });

  it(
    'leaves an already-instantiated onboarding unchanged after the template is edited',
    async () => {
      // ============================================================
      // 1. CREATE EMPLOYEE
      // ============================================================

      const createUserRes = await request(app.getHttpServer())
        .post('/auth/users')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          fullName: 'Template Immutability Test',
          phoneNumber: '+10000000001',
          role: 'employee',
          departmentId: engineeringDeptId,
        });

      expect(createUserRes.status).toBe(201);

      createdUserId = createUserRes.body.user.id;

      expect(createdUserId).toBeDefined();

      // ============================================================
      // 2. CREATE ONBOARDING
      //
      // The onboarding should snapshot the CURRENT active template.
      // ============================================================

      const createOnboardingRes = await request(app.getHttpServer())
        .post('/onboardings')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          userId: createdUserId,
          startDate: '2026-09-07',
        });

      expect(createOnboardingRes.status).toBe(201);

      createdOnboardingId = createOnboardingRes.body.id;

      expect(createdOnboardingId).toBeDefined();

      const tasksBefore =
        createOnboardingRes.body.tasks as Array<Record<string, any>>;

      expect(tasksBefore.length).toBeGreaterThan(0);

      // ============================================================
      // 3. EDIT TEMPLATE
      //
      // Publishing a new version should NOT modify the onboarding
      // that was already instantiated above.
      // ============================================================

      const newVersionRes = await request(app.getHttpServer())
        .post(
          `/templates/${originalActiveTemplateId}/versions`,
        )
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          tasks: [
            {
              title:
                'COMPLETELY DIFFERENT TASK — must never reach the existing joiner',
              ownerRole: 'task_owner',
              dueOffsetDays: 0,
              completionMode: 'dual',
              isCheckpoint: true,
            },
          ],
        });

      expect(newVersionRes.status).toBe(201);

      newTemplateVersionId = newVersionRes.body.id;

      expect(newTemplateVersionId).toBeDefined();

      expect(newVersionRes.body.version).toBeGreaterThan(1);

      // ============================================================
      // 4. READ EXISTING ONBOARDING TASKS DIRECTLY FROM DATABASE
      //
      // This proves the instantiated onboarding did not change.
      // ============================================================

      const { rows: tasksAfter } =
        await db.query<Record<string, any>>(
          `SELECT *
           FROM onboarding_tasks
           WHERE onboarding_id = $1
           ORDER BY due_date, created_at`,
          [createdOnboardingId],
        );

      expect(tasksAfter).toHaveLength(tasksBefore.length);

      tasksAfter.forEach((after, i) => {
        const before = tasksBefore[i];

        expect(after.id).toBe(before.id);
        expect(after.title).toBe(before.title);

        expect(
          after.due_date.toISOString().slice(0, 10),
        ).toBe(
          before.due_date.slice(0, 10),
        );

        expect(after.completion_mode).toBe(
          before.completion_mode,
        );

        expect(after.is_checkpoint).toBe(
          before.is_checkpoint,
        );
      });

      // The newly published task must NOT appear in the existing
      // onboarding.
      expect(
        tasksAfter.some((task) =>
          task.title.includes(
            'COMPLETELY DIFFERENT TASK',
          ),
        ),
      ).toBe(false);

      // ============================================================
      // 5. VERIFY NEW TEMPLATE IS NOW ACTIVE
      //
      // A NEW onboarding should use the new template version.
      // ============================================================

      const activeTemplateRes = await request(
        app.getHttpServer(),
      )
        .get('/templates/active')
        .query({
          departmentId: engineeringDeptId,
        })
        .set(
          'Authorization',
          `Bearer ${superadminToken}`,
        );

      expect(activeTemplateRes.status).toBe(200);

      expect(activeTemplateRes.body.id).toBe(
        newTemplateVersionId,
      );
    },
  );
});