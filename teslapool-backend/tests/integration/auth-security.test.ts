import jwt from 'jsonwebtoken';
import request from 'supertest';
import { makeHarness, registerUser, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeAll(() => resetDb(h.prisma));
afterAll(() => h.close());

describe('authentication', () => {
  it('registers with an Argon2id hash and never returns it', async () => {
    const res = await request(h.app).post('/api/v1/auth/register').send({ name: 'Nusrat', email: 'Nusrat@Example.com', password: 'correct-horse-battery' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'nusrat@example.com', role: 'PASSENGER' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { email: 'nusrat@example.com' } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects duplicate emails', async () => {
    const res = await request(h.app).post('/api/v1/auth/register').send({ name: 'Dup', email: 'nusrat@example.com', password: 'correct-horse-battery' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('does not allow self-registration as ADMIN (privilege escalation)', async () => {
    const res = await request(h.app).post('/api/v1/auth/register').send({ name: 'Eve', email: 'eve@example.com', password: 'correct-horse-battery', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in, and gives the same answer for a wrong password and an unknown email', async () => {
    const ok = await request(h.app).post('/api/v1/auth/login').send({ email: 'nusrat@example.com', password: 'correct-horse-battery' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.tokenType).toBe('Bearer');
    const wrong = await request(h.app).post('/api/v1/auth/login').send({ email: 'nusrat@example.com', password: 'nope-nope-nope' });
    const unknown = await request(h.app).post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: unknown.body.error.message });
  });

  it('GET /auth/me returns the caller', async () => {
    const u = await registerUser(h.app, 'DRIVER', 'Jashim Uddin');
    const res = await request(h.app).get('/api/v1/auth/me').set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: u.id, role: 'DRIVER' });
  });
});

describe('JWT validation (failure injection)', () => {
  const secret = process.env.JWT_SECRET!;
  const opts = { issuer: 'teslapool-api', audience: 'teslapool-clients' };

  it.each([
    ['missing', undefined],
    ['garbage', 'Bearer not-a-jwt'],
    ['wrong secret', `Bearer ${jwt.sign({ role: 'ADMIN' }, 'x'.repeat(40), { ...opts, subject: '00000000-0000-0000-0000-000000000000' })}`],
    ['alg=none', `Bearer ${jwt.sign({ role: 'ADMIN', sub: 'x' }, '', { algorithm: 'none' })}`],
    ['wrong audience', `Bearer ${jwt.sign({ role: 'ADMIN' }, secret, { issuer: 'teslapool-api', audience: 'other', subject: 'x' })}`],
  ])('rejects %s tokens with 401', async (_label, header) => {
    const req = request(h.app).get('/api/v1/auth/me');
    const res = header ? await req.set('Authorization', header) : await req;
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects expired tokens with reason TOKEN_EXPIRED', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const expired = jwt.sign({ role: 'PASSENGER' }, secret, { ...opts, subject: u.id, expiresIn: -10 });
    const res = await request(h.app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.details.reason).toBe('TOKEN_EXPIRED');
  });

  it('a valid token for a deactivated account stops working immediately', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    await h.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    const res = await request(h.app).get('/api/v1/auth/me').set(u.auth);
    expect(res.status).toBe(401);
  });

  it('a forged role claim is ignored: authorization uses the role stored in the database', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const forged = jwt.sign({ role: 'DRIVER' }, secret, { ...opts, subject: u.id });
    const res = await request(h.app).post('/api/v1/vehicles').set('Authorization', `Bearer ${forged}`).send({ name: 'Bullet', vehicleType: 'AUTO_RICKSHAW', registrationNumber: 'FORGED-1' });
    expect(res.status).toBe(403);
  });
});

describe('input hardening', () => {
  it('blocks mass assignment: unknown fields such as role are rejected', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const res = await request(h.app).patch('/api/v1/users/me').set(u.auth).send({ name: 'New Name', role: 'ADMIN' });
    expect(res.status).toBe(400);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.role).toBe('PASSENGER');
  });

  it('updates only whitelisted profile fields', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const res = await request(h.app).patch('/api/v1/users/me').set(u.auth).send({ name: 'Rafiq Ahmed', phone: '+8801711111111' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Rafiq Ahmed', phone: '+8801711111111' });
  });

  it('returns MALFORMED_JSON for broken bodies and 413 for oversized ones', async () => {
    const bad = await request(h.app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MALFORMED_JSON');
    const big = await request(h.app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(40_000) });
    expect(big.status).toBe(413);
  });

  it('rejects malformed UUIDs and oversize strings', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    expect((await request(h.app).get('/api/v1/rides/not-a-uuid').set(u.auth)).status).toBe(400);
    expect((await request(h.app).patch('/api/v1/users/me').set(u.auth).send({ name: 'x'.repeat(101) })).status).toBe(400);
  });

  it('propagates a safe X-Request-ID and replaces an unsafe one', async () => {
    const good = await request(h.app).get('/health').set('X-Request-ID', 'demo-request-0001');
    expect(good.headers['x-request-id']).toBe('demo-request-0001');
    const evil = await request(h.app).get('/health').set('X-Request-ID', 'abc" level="error" forged=<script>');
    expect(evil.headers['x-request-id']).not.toContain('forged');
    expect(evil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the error envelope for unknown routes, with a requestId and no stack trace', async () => {
    const res = await request(h.app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.requestId).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it('sets security headers', async () => {
    const res = await request(h.app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('only reflects allowed CORS origins', async () => {
    const allowed = await request(h.app).get('/health').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await request(h.app).get('/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
