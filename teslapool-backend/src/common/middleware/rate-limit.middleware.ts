import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from '../../config/env';
import '../express-augment';
import { ErrorCode } from '../errors';
import { currentRequestId } from '../request-context';

/**
 * In-memory rate limiting (single instance). For horizontal scaling, plug a shared
 * store (e.g. Redis) into express-rate-limit; the call sites do not change.
 * Authenticated limiters key on the user id, anonymous ones on client IP
 * (correct behind Render's proxy when TRUST_PROXY=1).
 */
function limiter(cfg: AppConfig, windowMs: number, limit: number, byUser: boolean, skipSuccessfulRequests = false): RequestHandler {
  if (!cfg.rateLimit.enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Brute-force limits count only failures, so switching between valid demo accounts never locks anyone out.
    skipSuccessfulRequests,
    keyGenerator: byUser ? (req) => req.auth?.userId ?? req.ip ?? 'unknown' : undefined,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: ErrorCode.RATE_LIMIT_EXCEEDED, message: 'Too many requests. Please slow down.', requestId: currentRequestId() },
      });
    },
  });
}

export function buildRateLimiters(cfg: AppConfig) {
  return {
    global: limiter(cfg, cfg.rateLimit.windowMs, cfg.rateLimit.max, false),
    /** Every request counts: actions that send an email or create an account (register, resend, forgot password). */
    auth: limiter(cfg, cfg.rateLimit.authWindowMs, cfg.rateLimit.authMax, false),
    /** Only failures count: guessing passwords or codes (login, verify email, reset password). */
    authAttempts: limiter(cfg, cfg.rateLimit.authWindowMs, cfg.rateLimit.authMax, false, true),
    rides: limiter(cfg, cfg.rateLimit.windowMs, cfg.rateLimit.rideMax, true),
    predictions: limiter(cfg, cfg.rateLimit.windowMs, cfg.rateLimit.predictionMax, true),
  };
}
export type RateLimiters = ReturnType<typeof buildRateLimiters>;
