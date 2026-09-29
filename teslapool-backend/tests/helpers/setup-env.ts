/** Runs before every test file, before any app module reads config. */
import { testDatabaseUrl } from './test-db-url';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl() ?? 'postgresql://unset:unset@localhost:5432/teslapool_test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.ML_SIDECAR_URL = '';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-0123456789';
