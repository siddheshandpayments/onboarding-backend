import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/tokens/token.service';

// Same env vars main.ts/ConfigModule expect from .env. Set only if not
// already present, so a real .env (or CI-provided env) always wins —
// this just lets the suite boot standalone otherwise. DATABASE_URL is
// never actually queried by the test below: RolesGuard rejects before
// the route handler (and therefore the database) is ever reached.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/onboarding_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_PREAUTH_SECRET ??= 'test-preauth-secret';
process.env.LOGIN_EMAIL_DOMAIN ??= 'id.onboarding.internal';
process.env.TOTP_ISSUER ??= 'Onboarding Platform';

describe('RolesGuard (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

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

    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  // POST /templates is @Roles('superadmin_hr') only. A real access
  // token for a low-priv role, sent over a real HTTP request, must be
  // rejected server-side — this is the guard doing the rejecting, not
  // a button hidden in some UI.
  it('rejects a low-privilege role on a superadmin-only route with 403', async () => {
    const employeeToken = tokens.signAccessToken({
      id: '11111111-1111-1111-1111-111111111111',
      role: 'employee',
    });

    const res = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  // Sanity check that the guard is actually doing the job, not just
  // JwtAuthGuard alone: no token at all must fail differently (401,
  // unauthenticated) than a valid-but-wrong-role token (403, forbidden).
  it('rejects the same route with no token at all as 401, not 403', async () => {
    const res = await request(app.getHttpServer()).post('/templates').send({});
    expect(res.status).toBe(401);
  });
});
