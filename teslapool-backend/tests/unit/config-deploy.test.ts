/**
 * Production configuration as hosting dashboards deliver it. Each case loads the config in a fresh
 * process with only the given variables (cwd has no .env), exactly like a container start.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const cwd = join(__dirname, '..', '.tmp-config-cwd');
mkdirSync(cwd, { recursive: true });
const envModule = join(__dirname, '..', '..', 'src', 'config', 'env.ts').replace(/\\/g, '/');

const RENDER = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://teslapool:secret@dpg-internal:5432/teslapool',
  JWT_SECRET: 'x'.repeat(48),
  CORS_ORIGINS: 'https://teslapool.vercel.app',
  PORT: '10000',
};

function load(env: Record<string, string>): { ok: true; cfg: Record<string, unknown> } | { ok: false; error: string } {
  const code = `import(${JSON.stringify('file:///' + envModule)}).then((m) => { const c = m.config ?? m.default.config; console.log(JSON.stringify({ email: c.email.verification, brevo: !!c.email.brevo, cors: c.corsOrigins, port: c.port, trust: c.trustProxy, secure: c.authCookie.secure })); })`;
  try {
    const out = execFileSync(process.execPath, ['--import', 'tsx', '-e', code], {
      cwd,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, cfg: JSON.parse(out.toString().trim().split('\n').pop()!) };
  } catch (e) {
    const stderr = String((e as { stderr?: Buffer }).stderr ?? e);
    return { ok: false, error: stderr.match(/Error: (.*)/)?.[1] ?? stderr };
  }
}

describe('production config (Render-style environment)', () => {
  it('starts with the minimal Render variables; cookies are Secure', () => {
    const r = load(RENDER);
    expect(r).toMatchObject({ ok: true, cfg: { port: 10000, secure: true, cors: ['https://teslapool.vercel.app'] } });
  });

  it('does not crash-loop when Brevo keys were forgotten: starts with verification off', () => {
    const r = load({ ...RENDER, EMAIL_VERIFICATION: 'required' });
    expect(r).toMatchObject({ ok: true, cfg: { email: 'off', brevo: false } });
  });

  it('keeps verification on when Brevo is configured', () => {
    const r = load({ ...RENDER, EMAIL_VERIFICATION: 'required', BREVO_API_KEY: 'xkeysib-test', BREVO_SENDER_EMAIL: 'hello@teslapool.dev' });
    expect(r).toMatchObject({ ok: true, cfg: { email: 'required', brevo: true } });
  });

  it('accepts YAML-mangled booleans (an unquoted `off` arrives as "false")', () => {
    expect(load({ ...RENDER, EMAIL_VERIFICATION: 'false' })).toMatchObject({ ok: true, cfg: { email: 'off' } });
    expect(load({ ...RENDER, EMAIL_VERIFICATION: 'OFF' })).toMatchObject({ ok: true, cfg: { email: 'off' } });
  });

  it('ignores a trailing slash pasted into CORS_ORIGINS', () => {
    const r = load({ ...RENDER, CORS_ORIGINS: 'https://teslapool.vercel.app/, https://teslapool-git-main.vercel.app/' });
    expect(r).toMatchObject({ ok: true, cfg: { cors: ['https://teslapool.vercel.app', 'https://teslapool-git-main.vercel.app'] } });
  });

  it('refuses to start without a real JWT secret or with a wildcard origin', () => {
    expect(load({ ...RENDER, JWT_SECRET: 'short' })).toMatchObject({ ok: false });
    const wildcard = load({ ...RENDER, CORS_ORIGINS: '*' });
    expect(wildcard).toMatchObject({ ok: false });
    if (!wildcard.ok) expect(wildcard.error).toContain('CORS_ORIGINS');
  });
});
