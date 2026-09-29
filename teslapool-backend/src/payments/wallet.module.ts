import type { PrismaClient, WalletTransaction } from '@prisma/client';
import { Router } from 'express';
import { asyncHandler, pageMeta, sendOk } from '../common/http';
import { authenticate, principal, requireVerifiedEmail } from '../common/middleware/auth.middleware';
import { idempotency } from '../common/middleware/idempotency.middleware';
import { parse } from '../common/validation';
import type { AppConfig } from '../config/env';
import { errorResponses, idempotencyHeader, jsonBody, jsonResponse, PaginationQuery, registry, z } from '../docs/openapi-registry';
import { money } from '../fares/fare-engine';
import { MAX_TOP_UP_POYSHA, WalletService } from './payments.service';

const Money = z.object({ amountPoysha: z.number().int(), amountBdt: z.number(), currency: z.literal('BDT') });
const WalletTxDto = registry.register(
  'WalletTransaction',
  z.object({
    id: z.string().uuid(),
    type: z.enum(['TOP_UP', 'RIDE_PAYMENT', 'RIDE_EARNING']),
    amount: Money.openapi({ description: 'Signed: positive = credit, negative = debit' }),
    balanceAfter: Money,
    rideRequestId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
  }),
);
const WalletDto = registry.register('Wallet', z.object({ balance: Money, transactions: z.array(WalletTxDto) }));
const TopUpBody = registry.register(
  'TopUpRequest',
  z.object({ amountPoysha: z.number().int().min(100).max(MAX_TOP_UP_POYSHA).openapi({ example: 50000, description: 'Simulated top-up in poysha (৳1 – ৳10,000). No real gateway.' }) }).strict(),
);

const sec = [{ bearerAuth: [] }];
registry.registerPath({ method: 'get', path: '/api/v1/wallet', tags: ['Wallet'], security: sec, summary: 'My simulated TeslaPay balance and ledger (newest first)', request: { query: PaginationQuery }, responses: { 200: jsonResponse('Wallet', WalletDto), ...errorResponses(401) } });
registry.registerPath({ method: 'post', path: '/api/v1/wallet/top-up', tags: ['Wallet'], security: sec, summary: 'Simulated top-up (no payment gateway). Use an Idempotency-Key so retries never double-credit.', request: { headers: idempotencyHeader, ...jsonBody(TopUpBody) }, responses: { 201: jsonResponse('Credited', WalletDto), ...errorResponses(400, 401, 409, 422) } });

const toTxDto = (t: WalletTransaction): z.infer<typeof WalletTxDto> => ({
  id: t.id,
  type: t.type,
  amount: money(t.amountPoysha),
  balanceAfter: money(t.balanceAfterPoysha),
  rideRequestId: t.rideRequestId,
  createdAt: t.createdAt.toISOString(),
});

export function walletRouter(prisma: PrismaClient, cfg: AppConfig, wallets: WalletService): Router {
  const router = Router();
  router.use(authenticate(prisma));

  const view = async (userId: string, page: number, limit: number) => {
    const [balance, { items, total }] = await Promise.all([wallets.balance(userId), wallets.history(userId, page, limit)]);
    return { body: { balance: money(balance), transactions: items.map(toTxDto) }, meta: pageMeta({ page, limit, skip: 0 }, total) };
  };

  router.get('/', asyncHandler(async (req, res) => {
    const { page, limit } = parse(PaginationQuery, req.query);
    const { body, meta } = await view(principal(req).userId, page, limit);
    sendOk(res, body, 200, meta);
  }));

  router.post('/top-up', requireVerifiedEmail(cfg.email.verification), idempotency(prisma, cfg.idempotencyTtlHours), asyncHandler(async (req, res) => {
    const { amountPoysha } = parse(TopUpBody, req.body);
    const userId = principal(req).userId;
    await wallets.topUp(userId, amountPoysha);
    const { body, meta } = await view(userId, 1, 20);
    sendOk(res, body, 201, meta);
  }));

  return router;
}
