
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';
import { DatabaseService } from '../src/database/database.service';

// This suite performs real writes.
// Always point DATABASE_URL at a disposable/dev database.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

describe('Step 37 gap coverage (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokens: TokenService;

  let superadminToken: string;
  let engineeringDeptId: string;

  const createdUserIds: string[] = [];
  const createdOnboardingIds: string[] = [];
  const createdNoteIds: string[] = [];

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

    /*
     * IMPORTANT:
     * This UUID only needs to be a syntactically valid UUID for signing
     * the token. The employee/task-owner tokens below use real user IDs.
     */
    superadminToken = tokens.signAccessToken({
      id: '5b4a3530-09da-4091-bf5b-6e20f5dce080',
      role: 'superadmin_hr',
    });

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
    /*
     * Delete onboarding tasks before onboardings because of FK constraints.
     */
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

    /*
     * Delete notes before users because notes reference users.
     */
    if (createdNoteIds.length) {
      await db.query(
        `DELETE FROM notes
         WHERE id = ANY($1::uuid[])`,
        [createdNoteIds],
      );
    }

    /*
     * Activity logs reference users through actor_id.
     * Therefore activity logs must be deleted BEFORE users.
     */
    if (createdUserIds.length) {
      await db.query(
        `DELETE FROM activity_logs
         WHERE actor_id = ANY($1::uuid[])`,
        [createdUserIds],
      );

      await db.query(
        `DELETE FROM users
         WHERE id = ANY($1::uuid[])`,
        [createdUserIds],
      );
    }

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createUser(
    fullName: string,
    role: 'employee' | 'task_owner',
    departmentId?: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        fullName,
        phoneNumber: `+1000000${String(
          1000 + createdUserIds.length,
        ).padStart(4, '0')}`,
        role,
        ...(departmentId ? { departmentId } : {}),
      });

    expect(res.status).toBe(201);

    const userId = res.body.user.id as string;

    createdUserIds.push(userId);

    return userId;
  }

  async function createOnboarding(
    userId: string,
    startDate: string,
  ): Promise<{
    onboardingId: string;
    tasks: Array<Record<string, any>>;
  }> {
    const res = await request(app.getHttpServer())
      .post('/onboardings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        userId,
        startDate,
      });

    expect(res.status).toBe(201);

    const onboardingId = res.body.id as string;

    createdOnboardingIds.push(onboardingId);

    return {
      onboardingId,
      tasks: res.body.tasks as Array<Record<string, any>>,
    };
  }

  // Some list endpoints in the current implementation return a plain
  // array, while paginated endpoints return { data, total, limit, offset }.
  // This helper lets the test assert the actual contract without assuming
  // every list endpoint is paginated.
  function responseItems(body: any): any[] {
    if (Array.isArray(body)) {
      return body;
    }

    if (Array.isArray(body?.data)) {
      return body.data;
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Employee isolation
  // ---------------------------------------------------------------------------

  describe('employee isolation', () => {
    it(
      'an employee only ever sees their own onboarding via /onboardings/me, ' +
        'and cannot reach HR-only endpoints',
      async () => {
        const employeeAId = await createUser(
          'Isolation Employee A',
          'employee',
          engineeringDeptId,
        );

        const employeeBId = await createUser(
          'Isolation Employee B',
          'employee',
          engineeringDeptId,
        );

        const { onboardingId: onboardingAId } =
          await createOnboarding(employeeAId, '2026-09-08');

        await createOnboarding(employeeBId, '2026-09-08');

        const tokenA = tokens.signAccessToken({
          id: employeeAId,
          role: 'employee',
        });

        const meRes = await request(app.getHttpServer())
          .get('/onboardings/me')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(meRes.status).toBe(200);

        /*
         * Current dashboard response contains the onboarding.
         */
        expect(meRes.body.onboarding.id).toBe(onboardingAId);

        const listAllRes = await request(app.getHttpServer())
          .get('/onboardings')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(listAllRes.status).toBe(403);

        const stuckRes = await request(app.getHttpServer())
          .get('/onboardings/stuck')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(stuckRes.status).toBe(403);

        const auditRes = await request(app.getHttpServer())
          .get('/activity-logs')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(auditRes.status).toBe(403);
      },
    );

    it(
      'a task_owner cannot call the employee-only /onboardings/me',
      async () => {
        const taskOwnerId = await createUser(
          'Isolation Task Owner',
          'task_owner',
        );

        const ownerToken = tokens.signAccessToken({
          id: taskOwnerId,
          role: 'task_owner',
        });

        const res = await request(app.getHttpServer())
          .get('/onboardings/me')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(403);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Task-owner isolation
  // ---------------------------------------------------------------------------

  describe('task owner isolation', () => {
    it(
      "a task_owner's /onboarding-tasks/mine never includes another " +
        "task_owner's claimed tasks",
      async () => {
        const employeeXId = await createUser(
          'Isolation Employee X',
          'employee',
          engineeringDeptId,
        );

        const employeeYId = await createUser(
          'Isolation Employee Y',
          'employee',
          engineeringDeptId,
        );

        const { tasks: tasksX } = await createOnboarding(
          employeeXId,
          '2026-09-08',
        );

        const { tasks: tasksY } = await createOnboarding(
          employeeYId,
          '2026-09-08',
        );

        const checkpointX = tasksX.find((task) => task.is_checkpoint);
        const checkpointY = tasksY.find((task) => task.is_checkpoint);

        expect(checkpointX).toBeDefined();
        expect(checkpointY).toBeDefined();

        const ownerXId = await createUser(
          'Isolation Owner X',
          'task_owner',
        );

        const ownerYId = await createUser(
          'Isolation Owner Y',
          'task_owner',
        );

        const ownerXToken = tokens.signAccessToken({
          id: ownerXId,
          role: 'task_owner',
        });

        const ownerYToken = tokens.signAccessToken({
          id: ownerYId,
          role: 'task_owner',
        });

        const claimXRes = await request(app.getHttpServer())
          .post(`/onboarding-tasks/${checkpointX!.id}/claim`)
          .set('Authorization', `Bearer ${ownerXToken}`)
          .send();

        expect(claimXRes.status).toBe(201);

        const claimYRes = await request(app.getHttpServer())
          .post(`/onboarding-tasks/${checkpointY!.id}/claim`)
          .set('Authorization', `Bearer ${ownerYToken}`)
          .send();

        expect(claimYRes.status).toBe(201);

        const mineXRes = await request(app.getHttpServer())
          .get('/onboarding-tasks/mine')
          .set('Authorization', `Bearer ${ownerXToken}`);

        expect(mineXRes.status).toBe(200);

        /*
         * IMPORTANT:
         * listMyTasks currently returns the list directly, not necessarily
         * { data: [...] }. Therefore do not blindly use body.data.
         */
        const mineX = responseItems(mineXRes.body);

        const mineXIds = mineX.map((task: any) => task.id);

        expect(mineXIds).toContain(checkpointX!.id);
        expect(mineXIds).not.toContain(checkpointY!.id);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Notes isolation
  // ---------------------------------------------------------------------------

  describe('notes isolation between two ordinary peers', () => {
    it(
      "one employee's notes are invisible to another employee, " +
        'not just to admins',
      async () => {
        const employeeId = await createUser(
          'Notes Owner Peer',
          'employee',
        );

        const peerId = await createUser(
          'Notes Peer',
          'employee',
        );

        const ownerToken = tokens.signAccessToken({
          id: employeeId,
          role: 'employee',
        });

        const peerToken = tokens.signAccessToken({
          id: peerId,
          role: 'employee',
        });

        const createRes = await request(app.getHttpServer())
          .post('/notes')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            content: 'peer-isolation-secret',
          });

        expect(createRes.status).toBe(201);

        const noteId = createRes.body.id as string;

        createdNoteIds.push(noteId);

        /*
         * Direct access to somebody else's note must be forbidden.
         */
        const peerReadRes = await request(app.getHttpServer())
          .get(`/notes/${noteId}`)
          .set('Authorization', `Bearer ${peerToken}`);

        expect(peerReadRes.status).toBe(403);

        /*
         * GET /notes currently returns NoteRow[] directly.
         * It does NOT return { data, total, limit, offset }.
         */
        const peerListRes = await request(app.getHttpServer())
          .get('/notes')
          .set('Authorization', `Bearer ${peerToken}`);

        expect(peerListRes.status).toBe(200);

        const peerNotes = responseItems(peerListRes.body);

        expect(
          peerNotes.some((note: any) => note.id === noteId),
        ).toBe(false);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Filtering / sorting / pagination
  // ---------------------------------------------------------------------------

  describe('filtering, sorting, and pagination (Step 32/33)', () => {
    it('rejects an unrecognized filter key with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          bogus: 'x',
        })
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(res.status).toBe(400);
    });

    it('rejects an unrecognized sort field with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          sort: 'bogus',
        })
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range limit with 400', async () => {
      const tooBig = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          limit: '1000',
        })
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(tooBig.status).toBe(400);

      const zero = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          limit: '0',
        })
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(zero.status).toBe(400);
    });

    it('actually sorts by startDate, ascending and descending', async () => {
      const employeeEarlyId = await createUser(
        'Sort Early',
        'employee',
        engineeringDeptId,
      );

      const employeeLateId = await createUser(
        'Sort Late',
        'employee',
        engineeringDeptId,
      );

      const { onboardingId: earlyId } = await createOnboarding(
        employeeEarlyId,
        '2026-09-01',
      );

      const { onboardingId: lateId } = await createOnboarding(
        employeeLateId,
        '2026-09-20',
      );

      /*
       * Do not send the department UUID here.
       *
       * The purpose of this assertion is sorting, so keep it independent
       * of department filtering.
       */
      const ascRes = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          sort: 'startDate',
          limit: '100',
        })
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(ascRes.status).toBe(200);

      const ascItems = responseItems(ascRes.body);

      const ascOurs = ascItems.filter((onboarding: any) =>
        [earlyId, lateId].includes(onboarding.id),
      );

      expect(ascOurs.map((onboarding: any) => onboarding.id)).toEqual([
        earlyId,
        lateId,
      ]);

      const descRes = await request(app.getHttpServer())
        .get('/onboardings')
        .query({
          sort: '-startDate',
          limit: '100',
        })
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(descRes.status).toBe(200);

      const descItems = responseItems(descRes.body);

      const descOurs = descItems.filter((onboarding: any) =>
        [earlyId, lateId].includes(onboarding.id),
      );

      expect(descOurs.map((onboarding: any) => onboarding.id)).toEqual([
        lateId,
        earlyId,
      ]);
    });

    it(
      'limit/offset actually page through onboardings, ' +
        'with an accurate total',
      async () => {
        /*
         * Test pagination on /onboardings because this is the Step 33
         * pagination endpoint.
         */

        const employeeAId = await createUser(
          'Pagination Employee A',
          'employee',
          engineeringDeptId,
        );

        const employeeBId = await createUser(
          'Pagination Employee B',
          'employee',
          engineeringDeptId,
        );

        const employeeCId = await createUser(
          'Pagination Employee C',
          'employee',
          engineeringDeptId,
        );

        const { onboardingId: onboardingAId } =
          await createOnboarding(employeeAId, '2026-10-01');

        const { onboardingId: onboardingBId } =
          await createOnboarding(employeeBId, '2026-10-02');

        const { onboardingId: onboardingCId } =
          await createOnboarding(employeeCId, '2026-10-03');

        /*
         * Use date filtering to isolate the three rows created by this
         * test rather than relying on the database being empty.
         */
        const page1 = await request(app.getHttpServer())
          .get('/onboardings')
          .query({
            dateFrom: '2026-10-01',
            dateTo: '2026-10-03',
            sort: 'startDate',
            limit: '2',
            offset: '0',
          })
          .set('Authorization', `Bearer ${superadminToken}`);

        expect(page1.status).toBe(200);

        expect(Array.isArray(page1.body.data)).toBe(true);
        expect(page1.body.data).toHaveLength(2);
        expect(page1.body.total).toBe(3);
        expect(page1.body.limit).toBe(2);
        expect(page1.body.offset).toBe(0);

        const page2 = await request(app.getHttpServer())
          .get('/onboardings')
          .query({
            dateFrom: '2026-10-01',
            dateTo: '2026-10-03',
            sort: 'startDate',
            limit: '2',
            offset: '2',
          })
          .set('Authorization', `Bearer ${superadminToken}`);

        expect(page2.status).toBe(200);
        expect(Array.isArray(page2.body.data)).toBe(true);
        expect(page2.body.data).toHaveLength(1);
        expect(page2.body.total).toBe(3);
        expect(page2.body.limit).toBe(2);
        expect(page2.body.offset).toBe(2);

        const page1Ids = page1.body.data.map(
          (onboarding: any) => onboarding.id,
        );

        const page2Ids = page2.body.data.map(
          (onboarding: any) => onboarding.id,
        );

        const allIds = [...page1Ids, ...page2Ids];

        expect(new Set(allIds).size).toBe(3);

        expect(allIds).toEqual([
          onboardingAId,
          onboardingBId,
          onboardingCId,
        ]);
      },
    );
  });
});
