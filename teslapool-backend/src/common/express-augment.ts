import type { UserRole } from '@prisma/client';

export interface AuthPrincipal {
  userId: string;
  role: UserRole;
  /** False until the user confirms their email with a code. */
  emailVerified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthPrincipal;
    }
  }
}

export {};
