import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { DatabaseService } from '../src/database/database.service';

// Same fallback env pattern as rbac.e2e-spec.ts. Unlike that suite,
// THIS one performs real writes against whatever DATABASE_URL points
// to — it needs an actual, fully-migrated Postgres database (all of
// migrations/, including the Engineering department + template seeds
// from 0003/0005). Point it at a disposable/dev database, never
// production data.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * The core BRD guarantee (M3 / "the two tests at demo"): editing a
 * department's template must never reach an onboarding already
 * instantiated from it. Everything this suite creates is torn down in
 * afterAll, and the Engineering template's original active version is
 * restored, so re-running it repeatedly against the same dev database
 * is safe.
 */
describe('Template immutability (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let superadminToken: string;

  let engineeringDeptId: string;
  let originalActiveTemplateId: string;
  let newTemplateVersionId: string | undefined;
  let createdUserId: string | undefined;
  let createdOnboardingId: string | undefined;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
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
    // RolesGuard only reads the role claim off the token — it never
    // looks the actor up in the database (see rbac.e2e-spec.ts) — so a
    // fabricated id is fine for a HR/SuperAdmin actor here too.
    superadminToken = tokens.signAccessToken({
      id: '99999999-9999-9999-9999-999999999999',
      role: 'superadmin_hr',
    });

    const { rows: deptRows } = await db.query<{ id: string }>(
      `SELECT id FROM departments WHERE name = 'Engineering'`,
    );
    if (!deptRows[0]) {
      throw new Error(
        "Engineering department not found — run migrations (0003) against this DATABASE_URL first.",
      );
    }
    engineeringDeptId = deptRows[0].id;

    const { rows: activeRows } = await db.query<{ id: string }>(
      `SELECT id FROM onboarding_templates WHERE department_id = $1 AND is_active = true`,
      [engineeringDeptId],
    );
    if (!activeRows[0]) {
      throw new Error(
        "No active Engineering template — run migrations (0005) against this DATABASE_URL first.",
      );
    }
    originalActiveTemplateId = activeRows[0].id;
  });

  afterAll(async () => {
    // Unwind everything this test created, in FK-safe order, then put
    // the seed data's original active version back exactly as found.
    if (createdOnboardingId) {
      await db.query(`DELETE FROM onboarding_tasks WHERE onboarding_id = $1`, [
        createdOnboardingId,
      ]);
      await db.query(`DELETE FROM onboardings WHERE id = $1`, [createdOnboardingId]);
    }
    if (createdUserId) {
      await db.query(`DELETE FROM users WHERE id = $1`, [createdUserId]);
    }
    if (newTemplateVersionId) {
      await db.query(`DELETE FROM template_tasks WHERE template_id = $1`, [
        newTemplateVersionId,
      ]);
      await db.query(`DELETE FROM onboarding_templates WHERE id = $1`, [
        newTemplateVersionId,
      ]);
    }
    if (originalActiveTemplateId) {
      await db.query(
        `UPDATE onboarding_templates SET is_active = true WHERE id = $1`,
        [originalActiveTemplateId],
      );
    }
    await app.close();
  });

  it('leaves an already-instantiated onboarding unchanged after the template is edited', async () => {
    // 1. Create a real Engineering employee and instantiate their
    //    onboarding from the CURRENT active template — this snapshot
    //    is what's under test.
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

    const createOnboardingRes = await request(app.getHttpServer())
      .post('/onboardings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ userId: createdUserId, startDate: '2026-09-07' });
    expect(createOnboardingRes.status).toBe(201);
    createdOnboardingId = createOnboardingRes.body.id;

    const tasksBefore = createOnboardingRes.body.tasks as Array<Record<string, any>>;
    expect(tasksBefore.length).toBeGreaterThan(0);

    // 2. Now edit the Engineering template: publish a new version with
    //    a deliberately unrecognizable task list.
    const newVersionRes = await request(app.getHttpServer())
      .post(`/templates/${originalActiveTemplateId}/versions`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        tasks: [
          {
            title: 'COMPLETELY DIFFERENT TASK — must never reach the existing joiner',
            ownerRole: 'task_owner',
            dueOffsetDays: 0,
            completionMode: 'dual',
            isCheckpoint: true,
          },
        ],
      });
    expect(newVersionRes.status).toBe(201);
    newTemplateVersionId = newVersionRes.body.id;
    expect(newVersionRes.body.version).toBeGreaterThan(1);

    // 3. Re-read the joiner's tasks straight from the database — not
    //    the earlier API response — to prove nothing in the snapshot
    //    moved after the edit.
    const { rows: tasksAfter } = await db.query<Record<string, any>>(
      `SELECT * FROM onboarding_tasks WHERE onboarding_id = $1 ORDER BY due_date, created_at`,
      [createdOnboardingId],
    );

    expect(tasksAfter).toHaveLength(tasksBefore.length);
    tasksAfter.forEach((after, i) => {
      const before = tasksBefore[i];
      expect(after.id).toBe(before.id);
      expect(after.title).toBe(before.title);
      expect(after.due_date.toISOString().slice(0, 10)).toBe(
        before.due_date.slice(0, 10),
      );
      expect(after.completion_mode).toBe(before.completion_mode);
      expect(after.is_checkpoint).toBe(before.is_checkpoint);
    });
    expect(
      tasksAfter.some((t) => t.title.includes('COMPLETELY DIFFERENT TASK')),
    ).toBe(false);

    // 4. Meanwhile, instantiating a joiner NOW would get the new
    //    version — the edit did take effect, just not retroactively.
    const activeTemplateRes = await request(app.getHttpServer())
      .get('/templates/active')
      .query({ departmentId: engineeringDeptId })
      .set('Authorization', `Bearer ${superadminToken}`);
    expect(activeTemplateRes.status).toBe(200);
    expect(activeTemplateRes.body.id).toBe(newTemplateVersionId);
  });
});
