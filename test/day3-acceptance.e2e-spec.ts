import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { DatabaseService } from '../src/database/database.service';

// Same fallback env pattern as the other e2e suites. This one performs
// real writes — point DATABASE_URL at a disposable/dev database, never
// production data.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

/**
 * Day 3's three closing acceptance tests (Step 24), each exercising a
 * different module built this week:
 *   1. The checkpoint (Step 16/17/18) cannot reach 'completed' from a
 *      single account — both sides must confirm independently.
 *   2. Notes (Step 23) — a SuperAdmin reading another user's note gets
 *      403, not a silent 404 or the note's content.
 *   3. Entitlements (Step 22) — two concurrent claims on the last unit
 *      of a scarce entitlement, only one succeeds.
 *
 * Everything created is torn down in afterAll, in FK-safe order.
 */
describe('Day 3 acceptance tests (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;
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
    superadminToken = tokens.signAccessToken({
      id: '88888888-8888-8888-8888-888888888888',
      role: 'superadmin_hr',
    });

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM departments WHERE name = 'Engineering'`,
    );
    if (!rows[0]) {
      throw new Error(
        'Engineering department not found — run migrations against this DATABASE_URL first.',
      );
    }
    engineeringDeptId = rows[0].id;
  });

  afterAll(async () => {
    if (createdOnboardingIds.length) {
      await db.query(
        `DELETE FROM onboarding_tasks WHERE onboarding_id = ANY($1::uuid[])`,
        [createdOnboardingIds],
      );
      await db.query(`DELETE FROM onboardings WHERE id = ANY($1::uuid[])`, [
        createdOnboardingIds,
      ]);
    }
    if (createdNoteIds.length) {
      await db.query(`DELETE FROM notes WHERE id = ANY($1::uuid[])`, [createdNoteIds]);
    }
    if (createdEntitlementIds.length) {
      await db.query(
        `DELETE FROM entitlement_assignments WHERE entitlement_id = ANY($1::uuid[])`,
        [createdEntitlementIds],
      );
      await db.query(`DELETE FROM entitlements WHERE id = ANY($1::uuid[])`, [
        createdEntitlementIds,
      ]);
    }
    if (createdUserIds.length) {
      await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    }
    await app.close();
  });

  // Creates a real row in `users` — required (not just convenient) for
  // any actor whose id will be written into a FK-constrained column
  // like onboarding_tasks.owner_confirmed_by/employee_confirmed_by
  // (both REFERENCES users(id)). Fabricating a token with a made-up id
  // is fine for pure role/identity *checks* (see rbac.e2e-spec.ts),
  // but not here — an id that's never actually inserted into `users`
  // would fail those confirmations with a foreign-key violation.
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

  const createEmployee = (fullName: string, departmentId?: string) =>
    createUser(fullName, 'employee', departmentId);

  it('the checkpoint cannot close from one account — both sides must confirm', async () => {
    const employeeId = await createEmployee('Checkpoint Test Employee', engineeringDeptId);

    const onboardingRes = await request(app.getHttpServer())
      .post('/onboardings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ userId: employeeId, startDate: '2026-09-07' });
    expect(onboardingRes.status).toBe(201);
    const onboardingId = onboardingRes.body.id as string;
    createdOnboardingIds.push(onboardingId);

    const checkpointTask = (onboardingRes.body.tasks as Array<Record<string, any>>).find(
      (t) => t.is_checkpoint,
    );
    expect(checkpointTask).toBeDefined();

    const taskOwnerId = await createUser('Checkpoint Test Owner', 'task_owner');
    const ownerToken = tokens.signAccessToken({ id: taskOwnerId, role: 'task_owner' });
    const empToken = tokens.signAccessToken({ id: employeeId, role: 'employee' });

    // Owner confirms alone — must NOT close the task.
    const ownerRes = await request(app.getHttpServer())
      .post(`/onboarding-tasks/${checkpointTask!.id}/complete-as-owner`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send();
    expect(ownerRes.status).toBe(201);
    expect(ownerRes.body.status).not.toBe('completed');

    const { rows: afterOwnerOnly } = await db.query(
      `SELECT status FROM onboarding_tasks WHERE id = $1`,
      [checkpointTask!.id],
    );
    expect(afterOwnerOnly[0].status).not.toBe('completed');

    // Employee confirms — NOW it closes, and phase-2 unlocks.
    const empRes = await request(app.getHttpServer())
      .post(`/onboarding-tasks/${checkpointTask!.id}/complete-as-employee`)
      .set('Authorization', `Bearer ${empToken}`)
      .send();
    expect(empRes.status).toBe(201);
    expect(empRes.body.status).toBe('completed');

    const { rows: onboardingAfter } = await db.query(
      `SELECT status FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    expect(onboardingAfter[0].status).toBe('active');

    const { rows: lockedAfter } = await db.query(
      `SELECT COUNT(*)::int AS count FROM onboarding_tasks WHERE onboarding_id = $1 AND status = 'locked'`,
      [onboardingId],
    );
    expect(lockedAfter[0].count).toBe(0);
  });

  it("a SuperAdmin gets 403 reading another user's notes, not 404 or the content", async () => {
    const noteOwnerId = await createEmployee('Notes Test Employee');
    const ownerToken = tokens.signAccessToken({ id: noteOwnerId, role: 'employee' });

    const createRes = await request(app.getHttpServer())
      .post('/notes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ content: 'this is private' });
    expect(createRes.status).toBe(201);
    const noteId = createRes.body.id as string;
    createdNoteIds.push(noteId);

    const adminReadRes = await request(app.getHttpServer())
      .get(`/notes/${noteId}`)
      .set('Authorization', `Bearer ${superadminToken}`);
    expect(adminReadRes.status).toBe(403);
    expect(JSON.stringify(adminReadRes.body)).not.toContain('this is private');

    // Sanity: a genuinely nonexistent note is still 404, not 403 —
    // proves the distinction is real, not "always 403".
    const missingRes = await request(app.getHttpServer())
      .get('/notes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${superadminToken}`);
    expect(missingRes.status).toBe(404);

    // The actual owner can still read it.
    const ownRes = await request(app.getHttpServer())
      .get(`/notes/${noteId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.content).toBe('this is private');
  });

  it('two concurrent claims on the last entitlement unit — only one succeeds', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/entitlements')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ name: 'Last Sports Kit', scope: 'company_wide', totalQuantity: 1 });
    expect(createRes.status).toBe(201);
    const entitlementId = createRes.body.id as string;
    createdEntitlementIds.push(entitlementId);

    const userXId = await createEmployee('Entitlement Racer X');
    const userYId = await createEmployee('Entitlement Racer Y');
    const tokenX = tokens.signAccessToken({ id: userXId, role: 'employee' });
    const tokenY = tokens.signAccessToken({ id: userYId, role: 'employee' });

    const [resX, resY] = await Promise.all([
      request(app.getHttpServer())
        .post(`/entitlements/${entitlementId}/claim`)
        .set('Authorization', `Bearer ${tokenX}`)
        .send(),
      request(app.getHttpServer())
        .post(`/entitlements/${entitlementId}/claim`)
        .set('Authorization', `Bearer ${tokenY}`)
        .send(),
    ]);

    const statuses = [resX.status, resY.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const { rows: entitlementAfter } = await db.query(
      `SELECT available_quantity FROM entitlements WHERE id = $1`,
      [entitlementId],
    );
    expect(entitlementAfter[0].available_quantity).toBe(0);

    const { rows: assignmentsAfter } = await db.query(
      `SELECT COUNT(*)::int AS count FROM entitlement_assignments WHERE entitlement_id = $1`,
      [entitlementId],
    );
    expect(assignmentsAfter[0].count).toBe(1);
  });
});
