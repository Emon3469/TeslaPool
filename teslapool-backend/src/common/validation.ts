import { z, ZodTypeAny } from 'zod';
import { ErrorCode, AppError } from './errors';

/** Parse untrusted input with a strict schema; failures become a 400 VALIDATION_ERROR listing every field. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const errors = result.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message, code: i.code }));
  throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed.', { errors });
}
