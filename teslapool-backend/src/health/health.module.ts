import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { asyncHandler } from '../common/http';
import { registry, z } from '../docs/openapi-registry';
import type { MlPredictor } from '../predictions/ml-predictor';

const started = Date.now();
const version = process.env.npm_package_version ?? '1.0.0';

registry.registerPath({
  method: 'get', path: '/health', tags: ['Health'], summary: 'Liveness: the process is up and serving HTTP (no dependencies checked)',
  responses: { 200: { description: 'Alive', content: { 'application/json': { schema: z.object({ status: z.literal('ok'), version: z.string(), uptimeSeconds: z.number() }) } } } },
});
registry.registerPath({
  method: 'get', path: '/health/ready', tags: ['Health'], summary: 'Readiness: database reachable (503 if not). ML status is informational: the API stays ready with deterministic fallback.',
  responses: { 200: { description: 'Ready' }, 503: { description: 'Database unreachable' } },
});

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

export function healthRouter(prisma: PrismaClient, ml: MlPredictor): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ status: 'ok', version, uptimeSeconds: Math.round((Date.now() - started) / 1000) });
  });

  router.get('/ready', asyncHandler(async (_req, res) => {
    const t0 = Date.now();
    let database: { status: 'up' | 'down'; latencyMs: number };
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 2000);
      database = { status: 'up', latencyMs: Date.now() - t0 };
    } catch {
      database = { status: 'down', latencyMs: Date.now() - t0 };
    }
    const mlHealth = await ml.health();
    const ready = database.status === 'up';
    res.status(ready ? 200 : 503).json({
      status: ready ? (mlHealth.status === 'up' ? 'ready' : 'ready_degraded') : 'not_ready',
      checks: {
        database,
        ml: { ...mlHealth, fallback: mlHealth.status === 'up' ? null : 'deterministic ETA and fare estimators active' },
      },
      version,
    });
  }));

  return router;
}
