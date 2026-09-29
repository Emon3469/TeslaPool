import { BrevoMailer } from '../../src/email/mailer';
import { passwordResetEmail, verificationEmail } from '../../src/email/templates';

const OPTS = { apiKey: 'xkeysib-test-key', senderEmail: 'hello@teslapool.dev', senderName: 'TeslaPool', apiUrl: 'https://api.brevo.com/v3/smtp/email', timeoutMs: 5000 };
const MSG = verificationEmail({ email: 'nusrat@example.com', name: 'Nusrat Jahan' }, '048213', 10, 'http://localhost:3000');

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('BrevoMailer (transactional API)', () => {
  it('posts one transactional email with the api-key header and the verified sender', async () => {
    const { fn, calls } = fakeFetch(201, { messageId: '<abc@smtp-relay.brevo.com>' });
    const result = await new BrevoMailer(OPTS, fn).send(MSG);

    expect(result.messageId).toBe('<abc@smtp-relay.brevo.com>');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test-key');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      sender: { email: 'hello@teslapool.dev', name: 'TeslaPool' },
      to: [{ email: 'nusrat@example.com', name: 'Nusrat Jahan' }],
      subject: '048213 is your TeslaPool verification code',
      tags: ['verify-email'],
    });
    // One box per digit, in order.
    expect(body.htmlContent).toMatch(/>0<\/div>[\s\S]*>4<\/div>[\s\S]*>8<\/div>[\s\S]*>2<\/div>[\s\S]*>1<\/div>[\s\S]*>3<\/div>/);
    expect(body.textContent).toContain('048213');
  });

  it('turns a Brevo rejection into EMAIL_DELIVERY_FAILED (502)', async () => {
    const { fn } = fakeFetch(401, { code: 'unauthorized', message: 'Key not found' });
    await expect(new BrevoMailer(OPTS, fn).send(MSG)).rejects.toMatchObject({ status: 502, code: 'EMAIL_DELIVERY_FAILED' });
  });

  it('turns a network failure or timeout into EMAIL_DELIVERY_FAILED', async () => {
    const failing = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;
    await expect(new BrevoMailer(OPTS, failing).send(MSG)).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' });
  });
});

describe('email templates', () => {
  it('escapes the user name and links to the right page', () => {
    const m = verificationEmail({ email: 'x@example.com', name: '<script>alert(1)</script> Evil' }, '123456', 10, 'https://teslapool.app');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('https://teslapool.app/verify-email');
    expect(m.text).toContain('expires in 10 minutes');
  });

  it('reset email links to the reset page with the email prefilled', () => {
    const m = passwordResetEmail({ email: 'rafiq+test@example.com', name: 'Rafiq Islam' }, '654321', 10, 'http://localhost:3000');
    expect(m.subject).toBe('654321 is your TeslaPool password reset code');
    expect(m.html).toContain('/reset-password?email=rafiq%2Btest%40example.com');
    expect(m.tag).toBe('reset-password');
  });
});
