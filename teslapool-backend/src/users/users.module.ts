import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { asyncHandler, sendOk } from '../common/http';
import { authenticate, principal } from '../common/middleware/auth.middleware';
import { parse } from '../common/validation';
import { errorResponses, jsonBody, jsonResponse, registry } from '../docs/openapi-registry';
import { toUserDto, UpdateMeBody, UserDto } from './users.dto';

registry.registerPath({
  method: 'patch', path: '/api/v1/users/me', tags: ['Users'], summary: 'Update my name/phone (email, role and status are not self-editable)',
  security: [{ bearerAuth: [] }],
  request: jsonBody(UpdateMeBody),
  responses: { 200: jsonResponse('Updated profile', UserDto), ...errorResponses(400, 401) },
});

/** Reading your profile is GET /auth/me; this router only updates it. */
export function usersRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(authenticate(prisma));

  router.patch('/me', asyncHandler(async (req, res) => {
    const body = parse(UpdateMeBody, req.body);
    // Explicit field mapping: role, email, isActive and passwordHash can never be mass-assigned.
    const user = await prisma.user.update({
      where: { id: principal(req).userId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
      },
    });
    sendOk(res, toUserDto(user));
  }));

  return router;
}
