/** Email ownership: verification codes gate booking/driving/top-up, and codes also reset passwords. */
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { config } from '../../src/config/env';
import type { Mailer, OutgoingEmail } from '../../src/email/mailer';
import { AppError, ErrorCode } from '../../src/common/errors';
import { resetDb } from '../helpers/harness';

class RecordingMailer implements Mailer {
  readonly name = 'recording';
  sent: OutgoingEmail[] = [];
  failNext = false;
  async send(m: OutgoingEmail) {
    if (this.failNext) {
      this.failNext = false;
      throw new AppError(502, ErrorCode.EMAIL_DELIVERY_FAILED, 'down');
    }
    this.sent.push(m);
    return { messageId: `msg-${this.sent.length}` };
  }
  lastCodeFor(email: string): string {
    const m = [...this.sent].reverse().find((x) => x.to.email === email);
    const code = m?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`no code emailed to ${email}`);
    return code;
  }
}

const prisma = new PrismaClient();
const mailer = new RecordingMailer();
let clock = Date.now();
const now = () => new Date(clock);
const cfg = { ...config, email: { ...config.email, verification: 'required' as const } };
const app = createApp({ prisma, config: cfg, mailer, now });

let n = 0;
async function register(role: 'PASSENGER' | 'DRIVER' = 'PASSENGER', name = 'Nusrat Jahan') {
  const email = `${name.split(' ')[0].toLowerCase()}.verify${n++}@test.dev`;
  const res = await request(app).post('/api/v1/auth/register').send({ name, email, password: 'correct-horse-battery', role });
  expect(res.status).toBe(201);
  return { email, auth: { Authorization: `Bearer ${res.body.data.accessToken}` }, body: res.body.data };
}
const advance = (seconds: number) => {
  clock += seconds * 1000;
};

beforeAll(() => resetDb(prisma));
beforeEach(() => {
  mailer.sent = [];
});
afterAll(() => prisma.$disconnect());

describe('registration sends a code; unverified accounts are gated', () => {
  it('emails a 6-digit code and stores only its hash', async () => {
    const u = await register();
    expect(u.body.verificationEmailSent).toBe(true);
    expect(u.body.user.emailVerified).toBe(false);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: { email: u.email, name: 'Nusrat Jahan' }, tag: 'verify-email' });

    const code = mailer.lastCodeFor(u.email);
    const row = await prisma.emailCode.findFirstOrThrow({ where: { user: { email: u.email } } });
    expect(row.codeHash).toHaveLength(64);
    expect(row.codeHash).not.toContain(code);
  });

  it('blocks booking until verified, but reading still works', async () => {
    const u = await register();
    const ride = await request(app).post('/api/v1/rides').set(u.auth).send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI' });
    expect(ride.status).toBe(403);
    expect(ride.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    await request(app).get('/api/v1/rides').set(u.auth).expect(200);
    await request(app).get('/api/v1/auth/me').set(u.auth).expect(200);
    const topUp = await request(app).post('/api/v1/wallet/top-up').set(u.auth).send({ amountPoysha: 10000 });
    expect(topUp.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('blocks a driver from going online until verified', async () => {
    const d = await register('DRIVER', 'Jashim Uddin');
    const v = await request(app).post('/api/v1/vehicles').set(d.auth).send({ name: 'Bullet', registrationNumber: `DHAKA-METRO-TA-${n}-2233` }).expect(201);
    const online = await request(app).post('/api/v1/driver/online').set(d.auth).send({ vehicleId: v.body.data.id });
    expect(online.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('verifies with the right code, then booking works; a second verify is a conflict', async () => {
    const u = await register();
    const wrong = await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: mailer.lastCodeFor(u.email) === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CODE', details: { attemptsLeft: 4 } });

    const ok = await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: mailer.lastCodeFor(u.email) }).expect(200);
    expect(ok.body.data.emailVerified).toBe(true);
    await request(app).post('/api/v1/rides').set(u.auth).send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI' }).expect(201);

    const again = await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: '123456' });
    expect(again.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('rejects malformed codes before touching the database', async () => {
    const u = await register();
    const res = await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: '12ab' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('code lifecycle', () => {
  it('locks the code after 5 wrong attempts, even for the right code', async () => {
    const u = await register();
    const right = mailer.lastCodeFor(u.email);
    const wrong = right === '999999' ? '888888' : '999999';
    const statuses: string[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: wrong })).body.error.code);
    expect(statuses).toEqual(['INVALID_CODE', 'INVALID_CODE', 'INVALID_CODE', 'INVALID_CODE', 'TOO_MANY_ATTEMPTS']);
    const blocked = await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: right });
    expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('parallel guesses cannot exceed the attempt limit', async () => {
    const u = await register();
    const right = mailer.lastCodeFor(u.email);
    const guesses = Array.from({ length: 12 }, (_, i) => String((Number(right) + i + 1) % 1_000_000).padStart(6, '0'));
    await Promise.all(guesses.map((code) => request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code })));
    const row = await prisma.emailCode.findFirstOrThrow({ where: { user: { email: u.email } } });
    expect(row.attempts).toBe(5);
  });

  it('expires codes, enforces the resend cooldown, and voids the old code on resend', async () => {
    const u = await register();
    const first = mailer.lastCodeFor(u.email);

    const soon = await request(app).post('/api/v1/auth/email/resend').set(u.auth);
    expect(soon.status).toBe(429);
    expect(soon.body.error).toMatchObject({ code: 'RESEND_TOO_SOON' });
    expect(soon.body.error.details.retryAfterSeconds).toBeGreaterThan(0);

    advance(11 * 60);
    const expired = await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: first });
    expect(expired.body.error.code).toBe('CODE_EXPIRED');

    const resent = await request(app).post('/api/v1/auth/email/resend').set(u.auth).expect(202);
    expect(resent.body.data).toEqual({ sent: true, retryAfterSeconds: 60 });
    const second = mailer.lastCodeFor(u.email);
    if (second !== first) {
      const old = await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: first });
      expect(old.body.error.code).toBe('INVALID_CODE');
    }
    await request(app).post('/api/v1/auth/email/verify').set(u.auth).send({ code: second }).expect(200);
  });

  it('still registers the account when the email provider is down', async () => {
    mailer.failNext = true;
    const u = await register();
    expect(u.body.verificationEmailSent).toBe(false);
    expect(await prisma.emailCode.count({ where: { user: { email: u.email } } })).toBe(0);
    // The failed code was discarded, so a resend is allowed straight away.
    await request(app).post('/api/v1/auth/email/resend').set(u.auth).expect(202);
  });
});

describe('password reset by email code', () => {
  it('answers 202 for unknown emails without sending anything', async () => {
    const res = await request(app).post('/api/v1/auth/password/forgot').send({ email: 'nobody@test.dev' }).expect(202);
    expect(res.body.data).toEqual({ sent: true });
    expect(mailer.sent).toHaveLength(0);
  });

  it('resets the password with the emailed code, once', async () => {
    const u = await register('PASSENGER', 'Rafiq Islam');
    advance(120);
    await request(app).post('/api/v1/auth/password/forgot').send({ email: u.email }).expect(202);
    const reset = mailer.sent.find((m) => m.tag === 'reset-password');
    expect(reset?.to.email).toBe(u.email);
    const code = mailer.lastCodeFor(u.email);

    await request(app).post('/api/v1/auth/password/reset').send({ email: u.email, code, newPassword: 'brand-new-password-1' }).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'correct-horse-battery' }).expect(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'brand-new-password-1' }).expect(200);
    // Receiving the reset code proved the inbox, so the email is now verified too.
    expect(login.body.data.user.emailVerified).toBe(true);

    const replay = await request(app).post('/api/v1/auth/password/reset').send({ email: u.email, code, newPassword: 'another-password-2' });
    expect(replay.body.error.code).toBe('INVALID_CODE');
  });

  it('gives the same error for unknown emails and wrong codes', async () => {
    const unknown = await request(app).post('/api/v1/auth/password/reset').send({ email: 'ghost@test.dev', code: '123456', newPassword: 'whatever-123' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVALID_CODE');
  });
});

it('publishes the verification mode in /meta for the frontend', async () => {
  const meta = await request(app).get('/api/v1/meta').expect(200);
  expect(meta.body.data.auth.emailVerification).toBe('required');
});
