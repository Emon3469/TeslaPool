import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'test') dotenv.config();

/**
 * Tests must be reproducible on any machine, so under NODE_ENV=test configuration is read ONLY
 * from this allowlist (set by tests/helpers/setup-env.ts); every business constant comes from the
 * code defaults. A plain "skip dotenv" is not enough: the Prisma client also loads .env into
 * process.env when it is first imported.
 */
const TEST_ENV_ALLOWLIST = ['NODE_ENV', 'DATABASE_URL', 'LOG_LEVEL', 'RATE_LIMIT_ENABLED', 'ML_SIDECAR_URL', 'JWT_SECRET'] as const;
function configSource(): NodeJS.ProcessEnv {
  if (process.env.NODE_ENV !== 'test') return process.env;
  return Object.fromEntries(TEST_ENV_ALLOWLIST.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

/**
 * Single source of runtime configuration. Every business constant lives here,
 * is overridable through the environment, and is validated at startup: a bad
 * value fails fast instead of silently producing wrong prices or matches.
 */

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');
const num = (def: number) => z.coerce.number().finite().default(def);
const int = (def: number) => z.coerce.number().int().default(def);

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0123456789';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  DATABASE_URL: z.string().url(),
  DB_TX_TIMEOUT_MS: int(10_000),
  DB_TX_MAX_WAIT_MS: int(10_000),

  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().default('1h'),
  JWT_ISSUER: z.string().default('teslapool-api'),
  JWT_AUDIENCE: z.string().default('teslapool-clients'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // HttpOnly session cookie (browser clients). Bearer tokens always work too.
  AUTH_COOKIE_ENABLED: bool.default('true'),
  AUTH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('tp_session'),
  AUTH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  AUTH_COOKIE_SECURE: bool.optional(),

  RATE_LIMIT_ENABLED: bool.default('true'),
  RATE_LIMIT_WINDOW_MS: int(60_000),
  RATE_LIMIT_MAX: int(300),
  AUTH_RATE_LIMIT_WINDOW_MS: int(15 * 60_000),
  AUTH_RATE_LIMIT_MAX: int(20),
  RIDE_RATE_LIMIT_MAX: int(30),
  PREDICTION_RATE_LIMIT_MAX: int(60),

  IDEMPOTENCY_TTL_HOURS: int(24),

  // Pool engine (hard constraints)
  POOL_MAX_CAPACITY: int(3),
  PICKUP_MAX_HOPS: int(1),
  DESTINATION_MAX_HOPS: int(2),
  MAX_DETOUR_KM: num(1.5),
  MAX_DETOUR_RATIO: num(0.3),
  // Per-rider urgency (chosen at request time): same max(km, ratio × solo) formula, own limits.
  URGENT_MAX_DETOUR_KM: num(0.5),
  URGENT_MAX_DETOUR_RATIO: num(0.1),
  FLEXIBLE_MAX_DETOUR_KM: num(3),
  FLEXIBLE_MAX_DETOUR_RATIO: num(0.6),
  MAX_STOPS: int(4),
  ALLOW_LATE_JOIN: bool.default('false'),
  MATCH_CANDIDATE_LIMIT: int(50),

  // Route scoring weights (lower score = better route)
  SCORE_WEIGHT_DISTANCE: num(0.35),
  SCORE_WEIGHT_DETOUR: num(0.25),
  SCORE_WEIGHT_STOPS: num(0.15),
  SCORE_WEIGHT_TIME_VARIANCE: num(0.1),
  SCORE_WEIGHT_SHARING: num(0.15),

  // Fare engine (integer poysha; 1 BDT = 100 poysha)
  FARE_BASE_POYSHA: int(5000),
  FARE_PER_KM_POYSHA: int(2000),
  FARE_PER_MIN_POYSHA: int(50),
  FARE_POOL_ALPHA: num(0.25),
  FARE_MAX_DISCOUNT: num(0.25),
  ML_FARE_MAX_DEVIATION: num(0.2),
  // deterministic: price = rule formula (hand-verifiable, default). ml_guarded: ML fare within the band may set the price.
  FARE_PRICING_MODE: z.enum(['deterministic', 'ml_guarded']).default('deterministic'),

  // Deterministic ETA fallback: minutes per km by traffic level (medians of the training data)
  ETA_MIN_PER_KM_LOW: num(3.3),
  ETA_MIN_PER_KM_MEDIUM: num(5.0),
  ETA_MIN_PER_KM_HIGH: num(7.5),
  ETA_MIN_PER_KM_GRIDLOCK: num(12.0),
  ETA_ML_MIN_RATIO: num(0.5),
  ETA_ML_MAX_RATIO: num(2.0),

  // Request context defaults (server-side; passengers cannot set surge)
  DEFAULT_VEHICLE_TYPE: z.enum(['AUTO_RICKSHAW', 'RICKSHAW', 'BIKE_RIDESHARE']).default('AUTO_RICKSHAW'),
  DEFAULT_WEATHER: z.enum(['CLEAR', 'OVERCAST', 'RAINY']).default('CLEAR'),
  SURGE_MULTIPLIER: num(1.0),

  // ML sidecar (optional: absent or failing => deterministic fallback)
  ML_SIDECAR_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  ML_TIMEOUT_MS: int(1500),
  ML_COOLDOWN_MS: int(30_000),

  // Transactional email (Brevo). Without an API key, codes are written to the dev log instead (never in production).
  BREVO_API_KEY: z.string().min(1).optional().or(z.literal('').transform(() => undefined)),
  BREVO_SENDER_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  BREVO_SENDER_NAME: z.string().min(1).max(70).default('TeslaPool'),
  BREVO_API_URL: z.string().url().default('https://api.brevo.com/v3/smtp/email'),
  EMAIL_TIMEOUT_MS: int(8000),
  // required: unverified accounts can sign in but cannot book, drive or top up. optional: codes sent, nothing gated. off: no codes.
  EMAIL_VERIFICATION: z.preprocess(
    (v) => {
      if (typeof v !== 'string' && typeof v !== 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      if (s === '') return undefined;
      if (['off', 'false', '0', 'no', 'disabled'].includes(s)) return 'off';
      if (['true', '1', 'yes', 'on'].includes(s)) return 'required';
      return s;
    },
    z.enum(['required', 'optional', 'off']).optional(),
  ),
  EMAIL_CODE_TTL_MINUTES: int(10),
  EMAIL_CODE_MAX_ATTEMPTS: int(5),
  EMAIL_CODE_RESEND_SECONDS: int(60),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Demo accounts (seed). Per-role passwords win over the shared SEED_PASSWORD, which wins over the defaults.
  SEED_PASSWORD: z.string().min(8).optional(),
  SEED_PASSENGER_PASSWORD: z.string().min(8).optional(),
  SEED_DRIVER_PASSWORD: z.string().min(8).optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
});

/** Documented demo credentials (README): used when the environment does not override them. */
export const DEMO_PASSWORDS = { PASSENGER: 'Passenger@2026', DRIVER: 'Driver@2026', ADMIN: 'Admin@2026' } as const;

function load() {
  const parsed = schema.safeParse(configSource());
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;

  if (e.NODE_ENV === 'production') {
    if (e.JWT_SECRET === DEV_JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
    if (e.CORS_ORIGINS.split(',').some((o) => o.trim() === '*')) {
      throw new Error('CORS_ORIGINS must not contain "*" in production');
    }
  }
  if (e.AUTH_COOKIE_SAMESITE === 'none' && e.AUTH_COOKIE_SECURE === false) {
    throw new Error('AUTH_COOKIE_SAMESITE=none requires AUTH_COOKIE_SECURE=true');
  }
  const weights = [e.SCORE_WEIGHT_DISTANCE, e.SCORE_WEIGHT_DETOUR, e.SCORE_WEIGHT_STOPS, e.SCORE_WEIGHT_TIME_VARIANCE, e.SCORE_WEIGHT_SHARING];
  if (weights.some((w) => w < 0)) throw new Error('Scoring weights must be non-negative');
  if (e.MAX_DETOUR_RATIO < 0 || e.MAX_DETOUR_KM < 0) throw new Error('Detour limits must be non-negative');
  // Urgent must never be looser than standard, nor flexible tighter: otherwise the labels would lie.
  if (e.URGENT_MAX_DETOUR_KM < 0 || e.URGENT_MAX_DETOUR_RATIO < 0 || e.URGENT_MAX_DETOUR_KM > e.MAX_DETOUR_KM || e.URGENT_MAX_DETOUR_RATIO > e.MAX_DETOUR_RATIO) {
    throw new Error('URGENT_MAX_DETOUR_* must be between 0 and the standard MAX_DETOUR_* limits');
  }
  if (e.FLEXIBLE_MAX_DETOUR_KM < e.MAX_DETOUR_KM || e.FLEXIBLE_MAX_DETOUR_RATIO < e.MAX_DETOUR_RATIO) {
    throw new Error('FLEXIBLE_MAX_DETOUR_* must be at least the standard MAX_DETOUR_* limits');
  }
  if (e.FARE_MAX_DISCOUNT < 0 || e.FARE_MAX_DISCOUNT > 1) throw new Error('FARE_MAX_DISCOUNT must be within [0, 1]');

  const toBps = (fraction: number) => Math.round(fraction * 10_000);

  // Tests never send email or gate on verification unless a test opts in explicitly.
  let verification = e.EMAIL_VERIFICATION ?? (e.NODE_ENV === 'test' ? 'off' : 'required');
  const brevo = e.BREVO_API_KEY && e.BREVO_SENDER_EMAIL ? { apiKey: e.BREVO_API_KEY, senderEmail: e.BREVO_SENDER_EMAIL, senderName: e.BREVO_SENDER_NAME, apiUrl: e.BREVO_API_URL } : null;
  if (e.BREVO_API_KEY && !e.BREVO_SENDER_EMAIL) {
    console.warn('[config] BREVO_API_KEY is set but BREVO_SENDER_EMAIL is not (it must be a sender verified in Brevo); email is disabled.');
  }
  // Production never writes codes to logs. Without a mail provider, start anyway with verification off
  // (a deploy with a forgotten key keeps working) and say so loudly instead of crash-looping.
  if (e.NODE_ENV === 'production' && verification !== 'off' && !brevo) {
    console.warn(`[config] EMAIL_VERIFICATION=${verification} needs BREVO_API_KEY and BREVO_SENDER_EMAIL; starting with email verification OFF.`);
    verification = 'off';
  }

  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    db: { txTimeoutMs: e.DB_TX_TIMEOUT_MS, txMaxWaitMs: e.DB_TX_MAX_WAIT_MS },
    jwt: { secret: e.JWT_SECRET, expiresIn: e.JWT_EXPIRES_IN, issuer: e.JWT_ISSUER, audience: e.JWT_AUDIENCE },
    // Browsers send Origin without a trailing slash; tolerate one pasted into the setting.
    corsOrigins: e.CORS_ORIGINS.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    authCookie: {
      enabled: e.AUTH_COOKIE_ENABLED,
      name: e.AUTH_COOKIE_NAME,
      sameSite: e.AUTH_COOKIE_SAMESITE,
      secure: e.AUTH_COOKIE_SECURE ?? (e.NODE_ENV === 'production' || e.AUTH_COOKIE_SAMESITE === 'none'),
    },
    rateLimit: {
      enabled: e.RATE_LIMIT_ENABLED,
      windowMs: e.RATE_LIMIT_WINDOW_MS,
      max: e.RATE_LIMIT_MAX,
      authWindowMs: e.AUTH_RATE_LIMIT_WINDOW_MS,
      authMax: e.AUTH_RATE_LIMIT_MAX,
      rideMax: e.RIDE_RATE_LIMIT_MAX,
      predictionMax: e.PREDICTION_RATE_LIMIT_MAX,
    },
    idempotencyTtlHours: e.IDEMPOTENCY_TTL_HOURS,
    pool: {
      maxCapacity: e.POOL_MAX_CAPACITY,
      pickupMaxHops: e.PICKUP_MAX_HOPS,
      destinationMaxHops: e.DESTINATION_MAX_HOPS,
      maxDetourKm: e.MAX_DETOUR_KM,
      maxDetourRatio: e.MAX_DETOUR_RATIO,
      urgentDetour: { km: e.URGENT_MAX_DETOUR_KM, ratio: e.URGENT_MAX_DETOUR_RATIO },
      flexibleDetour: { km: e.FLEXIBLE_MAX_DETOUR_KM, ratio: e.FLEXIBLE_MAX_DETOUR_RATIO },
      maxStops: e.MAX_STOPS,
      allowLateJoin: e.ALLOW_LATE_JOIN,
      candidateLimit: e.MATCH_CANDIDATE_LIMIT,
    },
    scoring: {
      distance: e.SCORE_WEIGHT_DISTANCE,
      detour: e.SCORE_WEIGHT_DETOUR,
      stops: e.SCORE_WEIGHT_STOPS,
      timeVariance: e.SCORE_WEIGHT_TIME_VARIANCE,
      sharing: e.SCORE_WEIGHT_SHARING,
    },
    fare: {
      basePoysha: e.FARE_BASE_POYSHA,
      perKmPoysha: e.FARE_PER_KM_POYSHA,
      perMinPoysha: e.FARE_PER_MIN_POYSHA,
      poolAlphaBps: toBps(e.FARE_POOL_ALPHA),
      maxDiscountBps: toBps(e.FARE_MAX_DISCOUNT),
      mlMaxDeviationBps: toBps(e.ML_FARE_MAX_DEVIATION),
      pricingMode: e.FARE_PRICING_MODE,
    },
    eta: {
      minPerKm: {
        LOW: e.ETA_MIN_PER_KM_LOW,
        MEDIUM: e.ETA_MIN_PER_KM_MEDIUM,
        HIGH: e.ETA_MIN_PER_KM_HIGH,
        GRIDLOCK: e.ETA_MIN_PER_KM_GRIDLOCK,
      },
      mlMinRatio: e.ETA_ML_MIN_RATIO,
      mlMaxRatio: e.ETA_ML_MAX_RATIO,
    },
    context: {
      defaultVehicleType: e.DEFAULT_VEHICLE_TYPE,
      defaultWeather: e.DEFAULT_WEATHER,
      surgeMultiplier: e.SURGE_MULTIPLIER,
    },
    ml: { sidecarUrl: e.ML_SIDECAR_URL, timeoutMs: e.ML_TIMEOUT_MS, cooldownMs: e.ML_COOLDOWN_MS },
    email: {
      verification,
      brevo,
      timeoutMs: e.EMAIL_TIMEOUT_MS,
      codeTtlMinutes: e.EMAIL_CODE_TTL_MINUTES,
      codeMaxAttempts: e.EMAIL_CODE_MAX_ATTEMPTS,
      resendSeconds: e.EMAIL_CODE_RESEND_SECONDS,
      appUrl: e.APP_URL.replace(/\/$/, ''),
    },
    seedPasswords: {
      PASSENGER: e.SEED_PASSENGER_PASSWORD ?? e.SEED_PASSWORD ?? DEMO_PASSWORDS.PASSENGER,
      DRIVER: e.SEED_DRIVER_PASSWORD ?? e.SEED_PASSWORD ?? DEMO_PASSWORDS.DRIVER,
      ADMIN: e.SEED_ADMIN_PASSWORD ?? e.SEED_PASSWORD ?? DEMO_PASSWORDS.ADMIN,
    },
  };
}

export type AppConfig = ReturnType<typeof load>;
export const config: AppConfig = load();

/** Subsets passed to pure domain modules, so they never import global config. */
export type PoolRules = AppConfig['pool'];
export type ScoringWeights = AppConfig['scoring'];
export type FareRates = AppConfig['fare'];
export type EtaRules = AppConfig['eta'];
