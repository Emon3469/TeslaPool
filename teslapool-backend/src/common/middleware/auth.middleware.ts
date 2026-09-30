import type { PrismaClient, UserRole } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isTrustedOrigin, readSessionCookie } from '../../auth/session-cookie';
import { verifyAccessToken } from '../../auth/tokens';
import '../express-augment';
import { AppError, ErrorCode, forbidden, unauthorized } from '../errors';
import { requestContext } from '../request-context';

/** Sent by the web app: the id of the account the tab is showing. Absent for scripts and mobile clients. */
export const EXPECTED_USER_HEADER = 'x-session-user';

/**
 * Verifies the Bearer JWT (HS256 only, issuer + audience checked), then loads the
 * user from the database on every request: a deactivated account or a changed
 * role takes effect immediately instead of when the token expires.
 */
export function authenticate(prisma: PrismaClient): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Bearer header (mobile, scripts, SPA with in-memory token) takes precedence over the session cookie.
    const header = req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const cookie = bearer ? null : readSessionCookie(req);
    const token = bearer ?? cookie;
    if (!token) return next(unauthorized('Missing Bearer token or session cookie.'));
    if (cookie && !isTrustedOrigin(req)) {
      // Name the rejected origin: a missing CORS_ORIGINS entry on the server is then obvious from one screenshot.
      const origin = req.header('origin') ?? null;
      return next(
        new AppError(403, ErrorCode.CSRF_ORIGIN_REJECTED, `This site (${origin ?? 'unknown origin'}) is not allowed to make changes. The server's CORS_ORIGINS must include it.`, { origin }),
      );
    }

    let userId: string;
    try {
      userId = verifyAccessToken(token).sub;
    } catch (err) {
      const expired = (err as Error).name === 'TokenExpiredError';
      return next(unauthorized(expired ? 'Access token expired.' : 'Invalid access token.', { reason: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' }));
    }

    prisma.user
      .findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, emailVerifiedAt: true } })
      .then((user) => {
        if (!user || !user.isActive) return next(unauthorized('Account not found or inactive.', { reason: 'ACCOUNT_INACTIVE' }));
        // All tabs of one browser share the session cookie, so signing in as someone else in another tab
        // switches every tab. A tab names the account it is showing; if the cookie now belongs to someone
        // else, refuse instead of acting (or reading) as that other account.
        const expected = req.header(EXPECTED_USER_HEADER);
        if (expected && expected !== user.id) {
          return next(
            new AppError(409, ErrorCode.SESSION_ACCOUNT_CHANGED, 'You signed in to a different account in another tab. Nothing was changed; reload this tab to continue.', {
              reason: 'SESSION_ACCOUNT_CHANGED',
            }),
          );
        }
        req.auth = { userId: user.id, role: user.role, emailVerified: user.emailVerifiedAt !== null };
        const ctx = requestContext.getStore();
        if (ctx) ctx.userId = user.id;
        next();
      })
      .catch(next);
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden(`This action requires role: ${roles.join(' or ')}.`));
    next();
  };
}

/**
 * With EMAIL_VERIFICATION=required, actions that commit someone else's time or money (requesting a
 * ride, going online, opening a pool, topping up) need a confirmed email. Reading data never does.
 */
export function requireVerifiedEmail(mode: 'required' | 'optional' | 'off'): RequestHandler {
  return (req, _res, next) => {
    if (mode !== 'required') return next();
    if (!req.auth) return next(unauthorized());
    if (!req.auth.emailVerified) {
      return next(new AppError(403, ErrorCode.EMAIL_NOT_VERIFIED, 'Confirm your email address first: enter the code we emailed you.', { verifyAt: '/verify-email' }));
    }
    next();
  };
}

/** For handlers mounted behind `authenticate`. */
export function principal(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
