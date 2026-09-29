import type { PrismaClient, UserRole } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isTrustedOrigin, readSessionCookie } from '../../auth/session-cookie';
import { verifyAccessToken } from '../../auth/tokens';
import '../express-augment';
import { AppError, ErrorCode, forbidden, unauthorized } from '../errors';
import { requestContext } from '../request-context';

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
      return next(new AppError(403, ErrorCode.CSRF_ORIGIN_REJECTED, 'Cookie-authenticated requests that change state must come from an allowed Origin.'));
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
