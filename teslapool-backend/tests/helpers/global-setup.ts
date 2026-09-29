import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './test-db-url';

/** Apply migrations to the isolated test schema exactly as production does (migrate deploy). */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();
  if (!url) throw new Error('DB tests need DATABASE_URL (in .env or the environment) or TEST_DATABASE_URL.');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
