import type { PrismaClient } from '@prisma/client';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { authRouter } from './auth/auth.module';
import { EmailCodeService } from './auth/email-codes';
import { buildMailer, type Mailer } from './email/mailer';
import { errorHandler, notFoundHandler } from './common/middleware/error.middleware';
import { buildRateLimiters } from './common/middleware/rate-limit.middleware';
import { requestContextMiddleware } from './common/middleware/request-context.middleware';
import { type AppConfig, config as defaultConfig } from './config/env';
import { openApiDocument } from './docs/openapi';
import { ZoneGraphDistanceProvider, type DistanceProvider } from './geography/distance-provider';
import { healthRouter } from './health/health.module';
import { driverRouter } from './driver/driver.module';
import { metaRouter } from './meta/meta.module';
import { WalletService } from './payments/payments.service';
import { walletRouter } from './payments/wallet.module';
import { statsRouter } from './stats/stats.module';
import { poolsRouter } from './pools/pools.module';
import { PoolService } from './pools/pools.service';
import { DisabledMlPredictor, HttpMlPredictor, type MlPredictor } from './predictions/ml-predictor';
import { PredictionService } from './predictions/prediction.service';
import { predictionsRouter } from './predictions/predictions.module';
import { ridesRouter } from './rides/rides.module';
import { RideExplanationService } from './rides/ride-explanation';
import { RideService } from './rides/rides.service';
import { usersRouter } from './users/users.module';
import { vehiclesRouter } from './vehicles/vehicles.module';

export interface AppDeps {
  prisma: PrismaClient;
  config?: AppConfig;
  ml?: MlPredictor;
  distance?: DistanceProvider;
  now?: () => Date;
  /** Outgoing email; defaults to Brevo when configured, otherwise the dev log. Tests inject a recorder. */
  mailer?: Mailer;
}

export function buildMlPredictor(cfg: AppConfig): MlPredictor {
  return cfg.ml.sidecarUrl ? new HttpMlPredictor(cfg.ml.sidecarUrl, cfg.ml.timeoutMs, cfg.ml.cooldownMs) : new DisabledMlPredictor();
}

/** Composition root: the only place that wires concrete implementations together. */
export function createApp(deps: AppDeps): Express {
  const cfg = deps.config ?? defaultConfig;
  const prisma = deps.prisma;
  const ml = deps.ml ?? buildMlPredictor(cfg);
  const distance = deps.distance ?? new ZoneGraphDistanceProvider();
  const predictions = new PredictionService(ml, cfg.eta, cfg.fare);
  const pools = new PoolService(prisma, cfg, distance);
  const rides = new RideService(prisma, cfg, distance, predictions, pools, deps.now);
  const explanations = new RideExplanationService(prisma, rides, cfg.fare);
  const limiters = buildRateLimiters(cfg);
  const codes = new EmailCodeService(prisma, cfg, deps.mailer ?? buildMailer(cfg), deps.now);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  app.use(requestContextMiddleware);
  // Pure JSON API: strict defaults. The docs UI below gets a CSP that allows its own inline styles.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || cfg.corsOrigins.includes(origin)),
      credentials: true, // allows the HttpOnly session cookie from allow-listed origins
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID', 'Idempotent-Replayed', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '32kb', strict: true }));

  app.use('/health', healthRouter(prisma, ml));

  const docsCsp = helmet.contentSecurityPolicy({
    directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"] },
  });
  app.get('/api/docs/openapi.json', (_req, res) => {
    res.json(openApiDocument());
  });
  app.use('/api/docs', docsCsp, swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/docs/openapi.json', persistAuthorization: true }, customSiteTitle: 'TeslaPool API' }));

  const v1 = express.Router();
  v1.use(limiters.global);
  v1.use('/meta', metaRouter(cfg, distance));
  v1.use('/stats', statsRouter(prisma));
  v1.use('/auth', authRouter(prisma, limiters, cfg, codes));
  v1.use('/users', usersRouter(prisma));
  v1.use('/vehicles', vehiclesRouter(prisma, cfg));
  v1.use('/rides', ridesRouter(prisma, cfg, rides, limiters, explanations));
  v1.use('/pools', poolsRouter(prisma, cfg, pools));
  v1.use('/driver', driverRouter(prisma, pools, cfg));
  v1.use('/wallet', walletRouter(prisma, cfg, new WalletService(prisma)));
  v1.use('/predictions', predictionsRouter(prisma, predictions, distance, limiters));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
