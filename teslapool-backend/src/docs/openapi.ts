import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './openapi-registry';

let cached: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;

/** Built lazily, after every module has registered its schemas and paths. */
export function openApiDocument() {
  cached ??= new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'TeslaPool API',
      version: '1.0.0',
      description: [
        'Transaction-safe, explainable ride pooling for Dhaka.',
        '',
        '**Predict → Decide → Guarantee.** ML estimates ETA and fare; deterministic domain rules decide capacity, route feasibility and ride state; PostgreSQL transactions guarantee consistency under concurrency.',
        '',
        'Money is integer **poysha** (1 BDT = 100 poysha). Every response uses the `{ success, data | error, meta.requestId }` envelope.',
        'Authenticate with `POST /api/v1/auth/login`, then send `Authorization: Bearer <accessToken>`.',
      ].join('\n'),
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Auth' }, { name: 'Users' }, { name: 'Vehicles' }, { name: 'Rides' }, { name: 'Driver lifecycle' },
      { name: 'Pools' }, { name: 'Driver' }, { name: 'Wallet' }, { name: 'Predictions' }, { name: 'Meta' }, { name: 'Stats' }, { name: 'Health' },
    ],
  });
  return cached;
}
