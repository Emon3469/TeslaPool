import type { UserRole } from '@prisma/client';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config/env';

/**
 * Short-lived HS256 access tokens. The algorithm is pinned on verification
 * (defeats alg=none / algorithm-confusion), and issuer + audience are checked.
 * Refresh tokens can be added later as a separate, DB-backed, rotating token
 * without changing this contract.
 */
export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
}

export function signAccessToken(userId: string, role: UserRole): { token: string; expiresIn: string } {
  const token = jwt.sign({ role }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: userId,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'],
  });
  return { token, expiresIn: config.jwt.expiresIn };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, config.jwt.secret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new jwt.JsonWebTokenError('invalid payload');
  return { sub: payload.sub, role: payload.role as UserRole };
}
