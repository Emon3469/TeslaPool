import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

/**
 * HttpOnly session cookie for browser clients: JavaScript can never read the token
 * (XSS cannot steal it). Because browsers attach cookies automatically, requests
 * authenticated BY COOKIE that change state must come from an allow-listed Origin
 * (CSRF defence, enforced in authenticate()). Bearer-token clients are unaffected.
 */

export function setSessionCookie(res: Response, token: string): void {
  if (!config.authCookie.enabled) return;
  const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
  res.cookie(config.authCookie.name, token, {
    httpOnly: true,
    secure: config.authCookie.secure,
    sameSite: config.authCookie.sameSite,
    path: '/',
    ...(exp ? { maxAge: Math.max(0, exp * 1000 - Date.now()) } : {}),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.authCookie.name, { httpOnly: true, secure: config.authCookie.secure, sameSite: config.authCookie.sameSite, path: '/' });
}

export function readSessionCookie(req: Request): string | null {
  if (!config.authCookie.enabled) return null;
  const header = req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === config.authCookie.name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF check for cookie-authenticated, state-changing requests. */
export function isTrustedOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  let origin = req.header('origin');
  if (!origin) {
    const referer = req.header('referer');
    if (!referer) return false;
    try {
      origin = new URL(referer).origin;
    } catch {
      return false;
    }
  }
  const self = `${req.protocol}://${req.get('host')}`;
  return origin === self || config.corsOrigins.includes(origin);
}
