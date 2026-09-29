import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { isUniqueViolation } from '../common/db';
import type { AppConfig } from '../config/env';
import { AppError, conflict, ErrorCode } from '../common/errors';
import { asyncHandler, sendOk } from '../common/http';
import { logger } from '../common/logger';
import { authenticate, principal } from '../common/middleware/auth.middleware';
import type { RateLimiters } from '../common/middleware/rate-limit.middleware';
import { parse } from '../common/validation';
import { errorResponses, jsonBody, jsonResponse, registry, z } from '../docs/openapi-registry';
import { PhoneSchema, toUserDto, UserDto } from '../users/users.dto';
import type { EmailCodeService } from './email-codes';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password';
import { clearSessionCookie, setSessionCookie } from './session-cookie';
import { signAccessToken } from './tokens';

const email = z.string().trim().toLowerCase().email().max(254);

export const RegisterBody = registry.register(
  'RegisterRequest',
  z
    .object({
      name: z.string().trim().min(1).max(100).openapi({ example: 'Nusrat' }),
      email: email.openapi({ example: 'nusrat@example.com' }),
      password: z.string().min(8).max(128).openapi({ example: 'correct-horse-battery' }),
      // ADMIN is deliberately not self-assignable (privilege escalation).
      role: z.enum(['PASSENGER', 'DRIVER']).default('PASSENGER'),
      phone: PhoneSchema.optional(),
    })
    .strict(),
);

export const LoginBody = registry.register(
  'LoginRequest',
  z.object({ email, password: z.string().min(1).max(128) }).strict(),
);

const AuthResult = registry.register(
  'AuthResult',
  z.object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.string().openapi({ example: '1h' }),
    user: UserDto,
    verificationEmailSent: z.boolean().optional().openapi({ description: 'Register only: whether the verification code email went out (resend with POST /auth/email/resend)' }),
  }),
);

const code = z.string().trim().regex(/^\d{6}$/, 'code must be 6 digits').openapi({ example: '482913' });
export const VerifyEmailBody = registry.register('VerifyEmailRequest', z.object({ code }).strict());
export const ForgotPasswordBody = registry.register('ForgotPasswordRequest', z.object({ email }).strict());
export const ResetPasswordBody = registry.register(
  'ResetPasswordRequest',
  z.object({ email, code, newPassword: z.string().min(8).max(128).openapi({ example: 'a-new-long-password' }) }).strict(),
);
const CodeSent = registry.register(
  'CodeSent',
  z.object({ sent: z.literal(true), retryAfterSeconds: z.number().int().openapi({ description: 'Wait this long before asking for another code' }) }),
);

registry.registerPath({
  method: 'post', path: '/api/v1/auth/register', tags: ['Auth'], summary: 'Register a passenger or driver',
  request: jsonBody(RegisterBody),
  responses: { 201: jsonResponse('Registered; returns an access token', AuthResult), ...errorResponses(400, 409, 429) },
});
registry.registerPath({
  method: 'post', path: '/api/v1/auth/login', tags: ['Auth'], summary: 'Exchange credentials for an access token (also sets an HttpOnly session cookie for browsers)',
  request: jsonBody(LoginBody),
  responses: { 200: jsonResponse('Authenticated', AuthResult), ...errorResponses(400, 401, 429) },
});
registry.registerPath({
  method: 'post', path: '/api/v1/auth/logout', tags: ['Auth'], summary: 'Clear the HttpOnly session cookie (Bearer clients just drop their token)',
  responses: { 200: jsonResponse('Logged out', z.object({ loggedOut: z.literal(true) })) },
});
registry.registerPath({
  method: 'post', path: '/api/v1/auth/email/verify', tags: ['Auth'], summary: 'Confirm your email with the 6-digit code that was emailed to you', security: [{ bearerAuth: [] }],
  request: jsonBody(VerifyEmailBody),
  responses: { 200: jsonResponse('Email verified; returns the updated user', UserDto), ...errorResponses(400, 401, 409, 429) },
});
registry.registerPath({
  method: 'post', path: '/api/v1/auth/email/resend', tags: ['Auth'], summary: 'Email a new verification code (voids the previous one; 60 s cooldown)', security: [{ bearerAuth: [] }],
  responses: { 202: jsonResponse('Code sent', CodeSent), ...errorResponses(401, 409, 429, 502) },
});
registry.registerPath({
  method: 'post', path: '/api/v1/auth/password/forgot', tags: ['Auth'], summary: 'Email a password reset code. Always answers 202, so it never reveals whether an account exists.',
  request: jsonBody(ForgotPasswordBody),
  responses: { 202: jsonResponse('If the account exists, a code was sent', z.object({ sent: z.literal(true) })), ...errorResponses(400, 429) },
});
registry.registerPath({
  method: 'post', path: '/api/v1/auth/password/reset', tags: ['Auth'], summary: 'Set a new password with the emailed reset code (also confirms the email address)',
  request: jsonBody(ResetPasswordBody),
  responses: { 200: jsonResponse('Password changed', z.object({ passwordReset: z.literal(true) })), ...errorResponses(400, 429) },
});
registry.registerPath({
  method: 'get', path: '/api/v1/auth/me', tags: ['Auth'], summary: 'Current user', security: [{ bearerAuth: [] }],
  responses: { 200: jsonResponse('Current user', UserDto), ...errorResponses(401) },
});

export function authRouter(prisma: PrismaClient, limiters: RateLimiters, cfg: Pick<AppConfig, 'email'>, codes: EmailCodeService): Router {
  const router = Router();
  const verificationOn = cfg.email.verification !== 'off';

  router.post('/register', limiters.auth, asyncHandler(async (req, res) => {
    const body = parse(RegisterBody, req.body);
    const passwordHash = await hashPassword(body.password);
    try {
      const user = await prisma.user.create({
        data: { name: body.name, email: body.email, passwordHash, role: body.role, phone: body.phone ?? null },
      });
      logger.info('auth.registered', { event: 'USER_REGISTERED', userId: user.id, role: user.role });
      // Registration never fails because email is down: the account exists and the user can resend.
      let verificationEmailSent = false;
      if (verificationOn) {
        verificationEmailSent = await codes.issue(user, 'VERIFY_EMAIL').then(
          () => true,
          (err) => {
            logger.error('auth.verification_email_failed', { event: 'VERIFICATION_EMAIL_FAILED', userId: user.id, code: (err as AppError).code });
            return false;
          },
        );
      }
      const { token, expiresIn } = signAccessToken(user.id, user.role);
      setSessionCookie(res, token);
      sendOk(res, { accessToken: token, tokenType: 'Bearer', expiresIn, user: toUserDto(user), ...(verificationOn ? { verificationEmailSent } : {}) }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(ErrorCode.EMAIL_ALREADY_REGISTERED, 'An account with this email already exists.');
      throw err;
    }
  }));

  router.post('/login', limiters.authAttempts, asyncHandler(async (req, res) => {
    const body = parse(LoginBody, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Always run one Argon2 verification so timing does not reveal whether the email exists.
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), body.password);
    if (!user || !ok || !user.isActive) {
      logger.warn('auth.login_failed', { event: 'LOGIN_FAILED' });
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password.');
    }
    const { token, expiresIn } = signAccessToken(user.id, user.role);
    setSessionCookie(res, token);
    sendOk(res, { accessToken: token, tokenType: 'Bearer', expiresIn, user: toUserDto(user) });
  }));

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    sendOk(res, { loggedOut: true });
  });

  router.post('/email/verify', limiters.authAttempts, authenticate(prisma), asyncHandler(async (req, res) => {
    const body = parse(VerifyEmailBody, req.body);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: principal(req).userId } });
    if (me.emailVerifiedAt) throw conflict(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Your email is already verified.');
    await codes.consume(me.id, 'VERIFY_EMAIL', body.code);
    const user = await prisma.user.update({ where: { id: me.id }, data: { emailVerifiedAt: new Date() } });
    logger.info('auth.email_verified', { event: 'EMAIL_VERIFIED', userId: user.id });
    sendOk(res, toUserDto(user));
  }));

  router.post('/email/resend', limiters.auth, authenticate(prisma), asyncHandler(async (req, res) => {
    if (!verificationOn) throw new AppError(409, ErrorCode.VERIFICATION_DISABLED, 'Email verification is turned off on this server.');
    const me = await prisma.user.findUniqueOrThrow({ where: { id: principal(req).userId } });
    if (me.emailVerifiedAt) throw conflict(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Your email is already verified.');
    const { retryAfterSeconds } = await codes.issue(me, 'VERIFY_EMAIL');
    sendOk(res, { sent: true, retryAfterSeconds }, 202);
  }));

  router.post('/password/forgot', limiters.auth, asyncHandler(async (req, res) => {
    const body = parse(ForgotPasswordBody, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Same answer whether or not the account exists, and whether or not the send worked (enumeration-safe).
    if (user?.isActive) {
      await codes.issue(user, 'RESET_PASSWORD').catch((err) => {
        logger.warn('auth.reset_code_not_sent', { event: 'RESET_CODE_NOT_SENT', userId: user.id, code: (err as AppError).code });
      });
    }
    sendOk(res, { sent: true }, 202);
  }));

  router.post('/password/reset', limiters.authAttempts, asyncHandler(async (req, res) => {
    const body = parse(ResetPasswordBody, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.isActive) throw new AppError(400, ErrorCode.INVALID_CODE, 'That code is not valid. Ask for a new one.', { attemptsLeft: 0 });
    await codes.consume(user.id, 'RESET_PASSWORD', body.code);
    await prisma.user.update({
      where: { id: user.id },
      // Receiving the code proves the inbox is theirs, so this also confirms the email.
      data: { passwordHash: await hashPassword(body.newPassword), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    logger.info('auth.password_reset', { event: 'PASSWORD_RESET', userId: user.id });
    sendOk(res, { passwordReset: true });
  }));

  router.get('/me', authenticate(prisma), asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: principal(req).userId } });
    sendOk(res, toUserDto(user));
  }));

  return router;
}
