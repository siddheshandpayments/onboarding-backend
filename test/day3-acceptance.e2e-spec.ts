import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';

import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { DatabaseService } from '../src/database/database.service';

// Same fallback env pattern as the other e2e suites.
// This test performs real writes — use a disposable/dev database,
// never production data.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * Day 3's three closing acceptance tests:
 *
 * 1. Checkpoint:
 *    Both the task owner and employee must independently confirm
 *    before the checkpoint becomes completed.
 *
 * 2. Notes:
 *    A SuperAdmin reading another user's note gets 403 and never
 *    receives the private note content.
 *
 * 3. Entitlements:
 *    Two concurrent claims against the final entitlement unit result
 *    in exactly one success (201) and one conflict (409).
 *
 * Everything created by this suite is cleaned up in afterAll.
 */
describe('Day 3 acceptance tests (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;

  // IMPORTANT:
  // The SuperAdmin must be a REAL user in the database.
  //
  // activity_logs.actor_id REFERENCES users(id), so a fabricated
  // UUID inside a JWT can cause a foreign-key violation.
  let testSuperadminId: string;
  let superadminToken: string;

  let engineeringDeptId: string;

  const createdUserIds: string[] = [];
  const createdOnboardingIds: string[] = [];
  const createdNoteIds: string[] = [];
  const createdEntitlementIds: string[] = [];

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
    tokens = moduleRef.get(TokenService);

    // ------------------------------------------------------------
    // Create a REAL SuperAdmin specifically for this test suite.
    //
    // We cannot use a fabricated JWT ID because:
    //
    // activity_logs.actor_id -> users.id
    //
    // The /auth/users endpoint creates activity logs using the
    // authenticated user's ID.
    // ------------------------------------------------------------

    const passwordHash = await bcrypt.hash(
      'Day3-Test-Password-123!',
      4,
    );

    const testAdminEmail = `day3-superadmin-${Date.now()}@id.onboarding.internal`;

    const { rows: adminRows } = await db.query<{ id: string }>(
      `INSERT INTO users (
        full_name,
        phone_number,
        temp_login_email,
        company_email,
        company_email_active,
        must_reset_password,
        password_hash,
        role,
        department_id,
        status
      )
      VALUES (
        'Day 3 Test SuperAdmin',
        '+10000000001',
        $1,
        NULL,
        false,
        false,
        $2,
        'superadmin_hr',
        NULL,
        'active'
      )
      RETURNING id`,
      [testAdminEmail, passwordHash],
    );

    if (!adminRows[0]) {
      throw new Error(
        'Failed to create Day 3 test SuperAdmin',
      );
    }

    testSuperadminId = adminRows[0].id;

    // Generate JWT using the REAL database user ID.
    superadminToken = tokens.signAccessToken({
      id: testSuperadminId,
      role: 'superadmin_hr',
    });

    // ------------------------------------------------------------
    // Find Engineering department.
    // ------------------------------------------------------------

    const { rows } = await db.query<{ id: string }>(
      `SELECT id
       FROM departments
       WHERE name = 'Engineering'`,
    );

    if (!rows[0]) {
      throw new Error(
        'Engineering department not found — run migrations against this DATABASE_URL first.',
      );
    }

    engineeringDeptId = rows[0].id;
  });

  afterAll(async () => {
    // ------------------------------------------------------------
    // IMPORTANT CLEANUP ORDER
    //
    // activity_logs.actor_id -> users.id
    //
    // Therefore activity logs must be deleted BEFORE their actor
    // users are deleted.
    // ------------------------------------------------------------

    if (createdUserIds.length) {
      await db.query(
        `DELETE FROM activity_logs
         WHERE actor_id = ANY($1::uuid[])`,
        [createdUserIds],
      );
    }

    if (testSuperadminId) {
      await db.query(
        `DELETE FROM activity_logs
         WHERE actor_id = $1`,
        [testSuperadminId],
      );
    }

    // ------------------------------------------------------------
    // Delete onboarding tasks first because they reference
    // onboardings.
    // ------------------------------------------------------------

    if (createdOnboardingIds.length) {
      await db.query(
        `DELETE FROM onboarding_tasks
         WHERE onboarding_id = ANY($1::uuid[])`,
        [createdOnboardingIds],
      );

      await db.query(
        `DELETE FROM onboardings
         WHERE id = ANY($1::uuid[])`,
        [createdOnboardingIds],
      );
    }

    // ------------------------------------------------------------
    // Delete notes.
    // ------------------------------------------------------------

    if (createdNoteIds.length) {
      await db.query(
        `DELETE FROM notes
         WHERE id = ANY($1::uuid[])`,
        [createdNoteIds],
      );
    }

    // ------------------------------------------------------------
    // Delete entitlement assignments before entitlements.
    // ------------------------------------------------------------

    if (createdEntitlementIds.length) {
      await db.query(
        `DELETE FROM entitlement_assignments
         WHERE entitlement_id = ANY($1::uuid[])`,
        [createdEntitlementIds],
      );

      await db.query(
        `DELETE FROM entitlements
         WHERE id = ANY($1::uuid[])`,
        [createdEntitlementIds],
      );
    }

    // ------------------------------------------------------------
    // Delete users created by the tests.
    // ------------------------------------------------------------

    if (createdUserIds.length) {
      await db.query(
        `DELETE FROM users
         WHERE id = ANY($1::uuid[])`,
        [createdUserIds],
      );
    }

    // ------------------------------------------------------------
    // Delete the temporary SuperAdmin created by this test suite.
    // ------------------------------------------------------------

    if (testSuperadminId) {
      await db.query(
        `DELETE FROM users
         WHERE id = $1`,
        [testSuperadminId],
      );
    }

    await app.close();
  });

  // ============================================================
  // Helper: create a real user through the API
  // ============================================================

  async function createUser(
    fullName: string,
    role: 'employee' | 'task_owner',
    departmentId?: string,
  ) {
    const res = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        fullName,
        phoneNumber: '+10000000002',
        role,
        ...(departmentId ? { departmentId } : {}),
      });

    expect(res.status).toBe(201);

    const userId = res.body.user.id as string;

    createdUserIds.push(userId);

    return userId;
  }

  const createEmployee = (
    fullName: string,
    departmentId?: string,
  ) =>
    createUser(
      fullName,
      'employee',
      departmentId,
    );

  // ============================================================
  // TEST 1
  // Both sides must confirm a checkpoint.
  // ============================================================

  it(
    'the checkpoint cannot close from one account — both sides must confirm',
    async () => {
      const employeeId = await createEmployee(
        'Checkpoint Test Employee',
        engineeringDeptId,
      );

      const onboardingRes = await request(app.getHttpServer())
        .post('/onboardings')
        .set(
          'Authorization',
          `Bearer ${superadminToken}`,
        )
        .send({
          userId: employeeId,
          startDate: '2026-09-07',
        });

      expect(onboardingRes.status).toBe(201);

      const onboardingId =
        onboardingRes.body.id as string;

      createdOnboardingIds.push(onboardingId);

      const checkpointTask = (
        onboardingRes.body.tasks as Array<
          Record<string, any>
        >
      ).find((t) => t.is_checkpoint);

      expect(checkpointTask).toBeDefined();

      const taskOwnerId = await createUser(
        'Checkpoint Test Owner',
        'task_owner',
      );

      const ownerToken = tokens.signAccessToken({
        id: taskOwnerId,
        role: 'task_owner',
      });

      const empToken = tokens.signAccessToken({
        id: employeeId,
        role: 'employee',
      });

      // ----------------------------------------------------------
      // Owner confirms alone.
      //
      // This must NOT complete the checkpoint.
      // ----------------------------------------------------------

      const ownerRes = await request(
        app.getHttpServer(),
      )
        .post(
          `/onboarding-tasks/${checkpointTask!.id}/complete-as-owner`,
        )
        .set(
          'Authorization',
          `Bearer ${ownerToken}`,
        )
        .send();

      expect(ownerRes.status).toBe(201);
      expect(ownerRes.body.status).not.toBe(
        'completed',
      );

      const { rows: afterOwnerOnly } =
        await db.query(
          `SELECT status
           FROM onboarding_tasks
           WHERE id = $1`,
          [checkpointTask!.id],
        );

      expect(
        afterOwnerOnly[0].status,
      ).not.toBe('completed');

      // ----------------------------------------------------------
      // Employee confirms.
      //
      // NOW both sides have confirmed, so it should complete.
      // ----------------------------------------------------------

      const empRes = await request(
        app.getHttpServer(),
      )
        .post(
          `/onboarding-tasks/${checkpointTask!.id}/complete-as-employee`,
        )
        .set(
          'Authorization',
          `Bearer ${empToken}`,
        )
        .send();

      expect(empRes.status).toBe(201);
      expect(empRes.body.status).toBe(
        'completed',
      );

      const { rows: onboardingAfter } =
        await db.query(
          `SELECT status
           FROM onboardings
           WHERE id = $1`,
          [onboardingId],
        );

      expect(
        onboardingAfter[0].status,
      ).toBe('active');

      const { rows: lockedAfter } =
        await db.query(
          `SELECT COUNT(*)::int AS count
           FROM onboarding_tasks
           WHERE onboarding_id = $1
             AND status = 'locked'`,
          [onboardingId],
        );

      expect(lockedAfter[0].count).toBe(0);
    },
  );

  // ============================================================
  // TEST 2
  // SuperAdmin cannot read another user's private note.
  // ============================================================

  it(
    "a SuperAdmin gets 403 reading another user's notes, not 404 or the content",
    async () => {
      const noteOwnerId =
        await createEmployee(
          'Notes Test Employee',
        );

      const ownerToken =
        tokens.signAccessToken({
          id: noteOwnerId,
          role: 'employee',
        });

      const createRes = await request(
        app.getHttpServer(),
      )
        .post('/notes')
        .set(
          'Authorization',
          `Bearer ${ownerToken}`,
        )
        .send({
          content: 'this is private',
        });

      expect(createRes.status).toBe(201);

      const noteId =
        createRes.body.id as string;

      createdNoteIds.push(noteId);

      // ----------------------------------------------------------
      // SuperAdmin attempts to read another user's note.
      // ----------------------------------------------------------

      const adminReadRes =
        await request(app.getHttpServer())
          .get(`/notes/${noteId}`)
          .set(
            'Authorization',
            `Bearer ${superadminToken}`,
          );

      expect(adminReadRes.status).toBe(403);

      expect(
        JSON.stringify(adminReadRes.body),
      ).not.toContain('this is private');

      // ----------------------------------------------------------
      // A genuinely nonexistent note should still return 404.
      // ----------------------------------------------------------

      const missingRes =
        await request(app.getHttpServer())
          .get(
            '/notes/00000000-0000-0000-0000-000000000000',
          )
          .set(
            'Authorization',
            `Bearer ${superadminToken}`,
          );

      expect(missingRes.status).toBe(404);

      // ----------------------------------------------------------
      // The actual owner can read their own note.
      // ----------------------------------------------------------

      const ownRes =
        await request(app.getHttpServer())
          .get(`/notes/${noteId}`)
          .set(
            'Authorization',
            `Bearer ${ownerToken}`,
          );

      expect(ownRes.status).toBe(200);
      expect(ownRes.body.content).toBe(
        'this is private',
      );
    },
  );

  // ============================================================
  // TEST 3
  // Two concurrent claims against one remaining entitlement.
  // ============================================================

  it(
    'two concurrent claims on the last entitlement unit — only one succeeds',
    async () => {
      const createRes =
        await request(app.getHttpServer())
          .post('/entitlements')
          .set(
            'Authorization',
            `Bearer ${superadminToken}`,
          )
          .send({
            name: 'Last Sports Kit',
            scope: 'company_wide',
            totalQuantity: 1,
          });

      expect(createRes.status).toBe(201);

      const entitlementId =
        createRes.body.id as string;

      createdEntitlementIds.push(
        entitlementId,
      );

      const userXId =
        await createEmployee(
          'Entitlement Racer X',
        );

      const userYId =
        await createEmployee(
          'Entitlement Racer Y',
        );

      const tokenX =
        tokens.signAccessToken({
          id: userXId,
          role: 'employee',
        });

      const tokenY =
        tokens.signAccessToken({
          id: userYId,
          role: 'employee',
        });

      const [resX, resY] =
        await Promise.all([
          request(app.getHttpServer())
            .post(
              `/entitlements/${entitlementId}/claim`,
            )
            .set(
              'Authorization',
              `Bearer ${tokenX}`,
            )
            .send(),

          request(app.getHttpServer())
            .post(
              `/entitlements/${entitlementId}/claim`,
            )
            .set(
              'Authorization',
              `Bearer ${tokenY}`,
            )
            .send(),
        ]);

      const statuses = [
        resX.status,
        resY.status,
      ].sort((a, b) => a - b);

      expect(statuses).toEqual([
        201,
        409,
      ]);

      // ----------------------------------------------------------
      // Exactly zero units should remain.
      // ----------------------------------------------------------

      const {
        rows: entitlementAfter,
      } = await db.query(
        `SELECT available_quantity
         FROM entitlements
         WHERE id = $1`,
        [entitlementId],
      );

      expect(
        entitlementAfter[0]
          .available_quantity,
      ).toBe(0);

      // ----------------------------------------------------------
      // Exactly one assignment should exist.
      // ----------------------------------------------------------

      const {
        rows: assignmentsAfter,
      } = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM entitlement_assignments
         WHERE entitlement_id = $1`,
        [entitlementId],
      );

      expect(
        assignmentsAfter[0].count,
      ).toBe(1);
    },
  );
});