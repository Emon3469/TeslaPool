import type { AppConfig } from '../config/env';
import { AppError, ErrorCode } from '../common/errors';
import { logger } from '../common/logger';

export interface OutgoingEmail {
  to: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
  /** Short machine tag for the provider's dashboards, e.g. "verify-email". */
  tag: string;
}

export interface Mailer {
  readonly name: string;
  send(message: OutgoingEmail): Promise<{ messageId: string | null }>;
}

/**
 * Brevo transactional email (POST /v3/smtp/email). Plain `fetch`, no SDK: one endpoint, typed here,
 * with a timeout. The API key travels only in the `api-key` header and is never logged.
 */
export class BrevoMailer implements Mailer {
  readonly name = 'brevo';

  constructor(
    private readonly opts: { apiKey: string; senderEmail: string; senderName: string; apiUrl: string; timeoutMs: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutgoingEmail): Promise<{ messageId: string | null }> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.apiUrl, {
        method: 'POST',
        headers: { 'api-key': this.opts.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: this.opts.senderEmail, name: this.opts.senderName },
          to: [{ email: message.to.email, name: message.to.name }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          tags: [message.tag],
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (err) {
      logger.error('email.send_failed', { event: 'EMAIL_SEND_FAILED', provider: this.name, tag: message.tag, reason: (err as Error).name });
      throw deliveryFailed();
    }

    const body = (await res.json().catch(() => null)) as { messageId?: string; code?: string; message?: string } | null;
    if (!res.ok) {
      // Brevo explains failures with a code (e.g. "unauthorized", "invalid_parameter"); log it, not the payload.
      logger.error('email.send_rejected', { event: 'EMAIL_SEND_REJECTED', provider: this.name, tag: message.tag, status: res.status, code: body?.code, detail: body?.message });
      throw deliveryFailed();
    }
    logger.info('email.sent', { event: 'EMAIL_SENT', provider: this.name, tag: message.tag, messageId: body?.messageId ?? null });
    return { messageId: body?.messageId ?? null };
  }
}

/** Development without Brevo: the email (and so the code) goes to the server log. Refused in production by config. */
export class LogMailer implements Mailer {
  readonly name = 'log';

  async send(message: OutgoingEmail): Promise<{ messageId: string | null }> {
    logger.warn('email.logged_not_sent', { event: 'EMAIL_LOGGED', tag: message.tag, to: message.to.email, subject: message.subject, text: message.text });
    return { messageId: null };
  }
}

export function buildMailer(cfg: AppConfig): Mailer {
  const b = cfg.email.brevo;
  return b ? new BrevoMailer({ ...b, timeoutMs: cfg.email.timeoutMs }) : new LogMailer();
}

function deliveryFailed() {
  return new AppError(502, ErrorCode.EMAIL_DELIVERY_FAILED, 'We could not send the email right now. Please try again in a minute.');
}
