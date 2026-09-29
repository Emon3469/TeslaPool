import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envFile = path.join(__dirname, '../../.env');
const fileEnv = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};

/**
 * DB-backed tests never touch development data. They use TEST_DATABASE_URL if set,
 * otherwise the DATABASE_URL database with a separate PostgreSQL schema
 * (`teslapool_test`). That needs no CREATEDB privilege: only the right to create a
 * schema in a database the role already uses.
 */
export function testDatabaseUrl(): string | null {
  const explicit = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set('schema', 'teslapool_test');
  return url.toString();
}
