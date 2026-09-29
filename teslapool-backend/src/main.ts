import http from 'node:http';
import { createApp } from './app';
import { createPrismaClient } from './common/db';
import { logger } from './common/logger';
import { config } from './config/env';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  await prisma.$connect();

  const server = http.createServer(createApp({ prisma }));
  server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts (Render/ALB)
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info('server.started', { event: 'SERVER_STARTED', host: config.host, port: config.port, env: config.env, mlSidecar: config.ml.sidecarUrl ?? 'disabled' });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server.shutdown', { event: 'SHUTDOWN_STARTED', signal });
    const force = setTimeout(() => {
      logger.error('server.shutdown_timeout', { event: 'SHUTDOWN_FORCED' });
      process.exit(1);
    }, 15_000);
    force.unref();
    // Stop accepting connections, let in-flight requests (and their transactions) finish, then close the pool.
    server.close(() => {
      prisma
        .$disconnect()
        .catch((err) => logger.error('db.disconnect_failed', { error: (err as Error).message }))
        .finally(() => {
          logger.info('server.stopped', { event: 'SHUTDOWN_COMPLETE' });
          process.exit(0);
        });
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('process.unhandled_rejection', { reason: String(reason) }));
}

main().catch((err) => {
  logger.error('server.start_failed', { error: (err as Error).message });
  process.exit(1);
});
