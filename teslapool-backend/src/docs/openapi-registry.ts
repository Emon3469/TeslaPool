import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/**
 * One registry for the whole API. Each module registers its request/response
 * schemas and paths next to its routes, and the SAME zod schemas validate the
 * requests, so the Swagger contract cannot drift from runtime behaviour.
 */
export const registry = new OpenAPIRegistry();

export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string().openapi({ example: 'CAPACITY_EXCEEDED' }),
      message: z.string().openapi({ example: 'The requested number of seats is not available.' }),
      details: z.record(z.unknown()).optional(),
      requestId: z.string().optional(),
    }),
  }),
);

const Meta = z.object({
  requestId: z.string(),
  page: z.number().int().optional(),
  limit: z.number().int().optional(),
  total: z.number().int().optional(),
  totalPages: z.number().int().optional(),
});

export const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data, meta: Meta });

const errorRef = { content: { 'application/json': { schema: ErrorResponse } } };
export const errorResponses = (...statuses: number[]) =>
  Object.fromEntries(
    statuses.map((s) => [
      s,
      {
        description:
          ({ 400: 'Validation error', 401: 'Missing, invalid or expired token', 403: 'Authenticated but not allowed', 404: 'Not found', 409: 'Conflict with current state', 422: 'Business rule rejected the request', 429: 'Rate limited' } as Record<number, string>)[s] ?? 'Error',
        ...errorRef,
      },
    ]),
  );

export const jsonBody = (schema: z.ZodTypeAny) => ({ body: { content: { 'application/json': { schema } } } });
export const jsonResponse = (description: string, schema: z.ZodTypeAny) => ({ description, content: { 'application/json': { schema: envelope(schema) } } });

export const idempotencyHeader = z.object({
  'idempotency-key': z.string().max(128).optional().openapi({ description: 'Optional. Replays of the same key+payload return the stored response.' }),
});

export const UuidParam = z.object({ id: z.string().uuid() });
export const PaginationQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export { z };
