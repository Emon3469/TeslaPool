/**
 * Stable, frontend-safe error codes. Domain codes (why a business rule said no)
 * are kept distinct from infrastructure codes (something broke).
 */
export const ErrorCode = {
  // Auth / access
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CSRF_ORIGIN_REJECTED: 'CSRF_ORIGIN_REJECTED',
  SESSION_ACCOUNT_CHANGED: 'SESSION_ACCOUNT_CHANGED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_ALREADY_VERIFIED: 'EMAIL_ALREADY_VERIFIED',
  VERIFICATION_DISABLED: 'VERIFICATION_DISABLED',
  INVALID_CODE: 'INVALID_CODE',
  CODE_EXPIRED: 'CODE_EXPIRED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  RESEND_TOO_SOON: 'RESEND_TOO_SOON',
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',

  // Domain: resources
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  VEHICLE_NOT_FOUND: 'VEHICLE_NOT_FOUND',
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
  VEHICLE_CAPACITY_EXCEEDED: 'VEHICLE_CAPACITY_EXCEEDED',
  REGISTRATION_NUMBER_TAKEN: 'REGISTRATION_NUMBER_TAKEN',
  RIDE_NOT_FOUND: 'RIDE_NOT_FOUND',
  ACTIVE_RIDE_EXISTS: 'ACTIVE_RIDE_EXISTS',
  RIDE_NOT_IN_POOL: 'RIDE_NOT_IN_POOL',
  POOL_NOT_FOUND: 'POOL_NOT_FOUND',
  ACTIVE_POOL_EXISTS: 'ACTIVE_POOL_EXISTS',
  POOL_NOT_EMPTY: 'POOL_NOT_EMPTY',
  INVALID_ZONE: 'INVALID_ZONE',
  SAME_PICKUP_AND_DROPOFF: 'SAME_PICKUP_AND_DROPOFF',

  // Domain: matching & lifecycle
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  PICKUP_TOO_FAR: 'PICKUP_TOO_FAR',
  DESTINATION_TOO_FAR: 'DESTINATION_TOO_FAR',
  DETOUR_TOO_HIGH: 'DETOUR_TOO_HIGH',
  MAX_STOPS_EXCEEDED: 'MAX_STOPS_EXCEEDED',
  POOL_ALREADY_STARTED: 'POOL_ALREADY_STARTED',
  POOL_CANCELLED: 'POOL_CANCELLED',
  LATE_JOIN_NOT_ALLOWED: 'LATE_JOIN_NOT_ALLOWED',
  DUPLICATE_MEMBERSHIP: 'DUPLICATE_MEMBERSHIP',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',

  // Payments / driver availability
  INSUFFICIENT_WALLET_BALANCE: 'INSUFFICIENT_WALLET_BALANCE',
  DRIVER_HAS_PASSENGERS: 'DRIVER_HAS_PASSENGERS',

  // ML (informational: these never fail a ride request, they appear in decisions)
  ML_PREDICTION_UNAVAILABLE: 'ML_PREDICTION_UNAVAILABLE',
  FARE_GUARDRAIL_TRIGGERED: 'FARE_GUARDRAIL_TRIGGERED',

  // Request / infrastructure
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MALFORMED_JSON: 'MALFORMED_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_REQUEST_IN_PROGRESS: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCodeValue,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: ErrorCodeValue, message: string, details?: Record<string, unknown>) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required.', details?: Record<string, unknown>) => new AppError(401, ErrorCode.UNAUTHORIZED, message, details);
export const forbidden = (message = 'You are not allowed to perform this action.') => new AppError(403, ErrorCode.FORBIDDEN, message);
export const notFound = (code: ErrorCodeValue, message: string) => new AppError(404, code, message);
export const conflict = (code: ErrorCodeValue, message: string, details?: Record<string, unknown>) => new AppError(409, code, message, details);
export const unprocessable = (code: ErrorCodeValue, message: string, details?: Record<string, unknown>) => new AppError(422, code, message, details);
