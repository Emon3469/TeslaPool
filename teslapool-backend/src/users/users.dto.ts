import type { User } from '@prisma/client';
import { registry, z } from '../docs/openapi-registry';

/** Explicit response shape: password hashes and internal fields never leave the server. */
export const UserDto = registry.register(
  'User',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    role: z.enum(['PASSENGER', 'DRIVER', 'ADMIN']),
    phone: z.string().nullable(),
    isActive: z.boolean(),
    emailVerified: z.boolean().openapi({ description: 'True once the user confirmed their email with an emailed code' }),
    createdAt: z.string().datetime(),
  }),
);

export function toUserDto(u: User): z.infer<typeof UserDto> {
  return { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, isActive: u.isActive, emailVerified: u.emailVerifiedAt !== null, createdAt: u.createdAt.toISOString() };
}

const phone = z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'phone must be 7-15 digits, optionally starting with +');

export const UpdateMeBody = registry.register(
  'UpdateMeRequest',
  z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      phone: phone.nullable().optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
);

export { phone as PhoneSchema };
