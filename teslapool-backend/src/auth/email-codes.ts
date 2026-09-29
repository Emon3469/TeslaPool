import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { EmailCodePurpose, PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env';
import { AppError, ErrorCode } from '../common/errors';
import { logger } from '../common/logger';
import type { Mailer } from '../email/mailer';
import { passwordResetEmail, verificationEmail } from '../email/templates';

type Recipient = { id: string; email: string; name: string };

/**
 * Six-digit one-time codes sent by email.
 *
 * - Only an HMAC of the code is stored (keyed with the server secret and bound to user + purpose),
 *   so a database leak does not reveal live codes.
 * - Issuing a code voids the previous ones; a code expires after `codeTtlMinutes`.
 * - Every check counts as an attempt, reserved atomically before comparing, so parallel guessing
 *   cannot exceed `codeMaxAttempts`.
 * - A resend cooldown stops the endpoint being used to flood an inbox.
 */
export class EmailCodeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: AppConfig,
    private readonly mailer: Mailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private hash(userId: string, purpose: EmailCodePurpose, code: string): string {
    return createHmac('sha256', this.cfg.jwt.secret).update(`${purpose}:${userId}:${code}`).digest('hex');
  }

  /** Seconds until another code may be sent (0 = now). */
  async cooldown(userId: string, purpose: EmailCodePurpose): Promise<number> {
    const latest = await this.prisma.emailCode.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (!latest) return 0;
    const elapsed = (this.now().getTime() - latest.createdAt.getTime()) / 1000;
    return Math.max(0, Math.ceil(this.cfg.email.resendSeconds - elapsed));
  }

  /**
   * Creates a fresh code and emails it. Throws RESEND_TOO_SOON inside the cooldown and
   * EMAIL_DELIVERY_FAILED if the provider refuses (the unsent code is discarded, so the user can retry).
   */
  async issue(user: Recipient, purpose: EmailCodePurpose): Promise<{ retryAfterSeconds: number }> {
    const wait = await this.cooldown(user.id, purpose);
    if (wait > 0) {
      throw new AppError(429, ErrorCode.RESEND_TOO_SOON, `Please wait ${wait} seconds before asking for another code.`, { retryAfterSeconds: wait });
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = this.now();
    const [, created] = await this.prisma.$transaction([
      this.prisma.emailCode.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.emailCode.create({
        data: { userId: user.id, purpose, codeHash: this.hash(user.id, purpose, code), expiresAt: new Date(now.getTime() + this.cfg.email.codeTtlMinutes * 60_000), createdAt: now },
      }),
    ]);

    const to = { email: user.email, name: user.name };
    const message =
      purpose === 'VERIFY_EMAIL'
        ? verificationEmail(to, code, this.cfg.email.codeTtlMinutes, this.cfg.email.appUrl)
        : passwordResetEmail(to, code, this.cfg.email.codeTtlMinutes, this.cfg.email.appUrl);
    try {
      await this.mailer.send(message);
    } catch (err) {
      await this.prisma.emailCode.delete({ where: { id: created.id } }).catch(() => undefined);
      throw err;
    }
    logger.info('auth.code_issued', { event: 'EMAIL_CODE_ISSUED', userId: user.id, purpose, mailer: this.mailer.name });
    return { retryAfterSeconds: this.cfg.email.resendSeconds };
  }

  /** Validates and consumes the live code. Errors: INVALID_CODE (with attemptsLeft), CODE_EXPIRED, TOO_MANY_ATTEMPTS. */
  async consume(userId: string, purpose: EmailCodePurpose, code: string): Promise<void> {
    const active = await this.prisma.emailCode.findFirst({ where: { userId, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!active) throw new AppError(400, ErrorCode.INVALID_CODE, 'That code is not valid. Ask for a new one.', { attemptsLeft: 0 });
    if (active.expiresAt <= this.now()) throw new AppError(400, ErrorCode.CODE_EXPIRED, 'That code has expired. Ask for a new one.');

    const max = this.cfg.email.codeMaxAttempts;
    const reserved = await this.prisma.emailCode.updateMany({ where: { id: active.id, consumedAt: null, attempts: { lt: max } }, data: { attempts: { increment: 1 } } });
    if (reserved.count === 0) throw new AppError(429, ErrorCode.TOO_MANY_ATTEMPTS, 'Too many wrong codes. Ask for a new one.');

    const expected = Buffer.from(active.codeHash, 'hex');
    const given = Buffer.from(this.hash(userId, purpose, code), 'hex');
    if (!timingSafeEqual(expected, given)) {
      const attemptsLeft = Math.max(0, max - (active.attempts + 1));
      logger.warn('auth.code_rejected', { event: 'EMAIL_CODE_REJECTED', userId, purpose, attemptsLeft });
      if (attemptsLeft === 0) throw new AppError(429, ErrorCode.TOO_MANY_ATTEMPTS, 'Too many wrong codes. Ask for a new one.');
      throw new AppError(400, ErrorCode.INVALID_CODE, `That code is not right. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`, { attemptsLeft });
    }

    // Consume exactly once, even if the same correct code is submitted twice at the same moment.
    const consumed = await this.prisma.emailCode.updateMany({ where: { id: active.id, consumedAt: null }, data: { consumedAt: this.now() } });
    if (consumed.count === 0) throw new AppError(400, ErrorCode.INVALID_CODE, 'That code was already used.', { attemptsLeft: 0 });
  }
}
