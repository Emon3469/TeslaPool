import type { PaymentMethod, PrismaClient, RideRequest } from '@prisma/client';
import { type Tx, withTransaction } from '../common/db';
import { AppError, ErrorCode } from '../common/errors';
import { logger } from '../common/logger';

/**
 * Payments: CASH (collected by the driver) or a simulated TeslaPay wallet. No real gateway.
 *
 * The wallet balance is owned by the database: inserting a wallet_transactions row fires a
 * trigger that locks the user, computes balance_after, refuses overdrafts and moves the balance
 * in the same statement. The application never writes users.wallet_balance_poysha directly.
 */

export const MAX_TOP_UP_POYSHA = 1_000_000; // ৳10,000 per simulated top-up

export interface Settlement {
  method: PaymentMethod;
  requestedMethod: PaymentMethod;
  amountPoysha: number;
  note: string | null;
}

/** Lock user rows in a globally consistent order (by id) to avoid deadlocks between settlements. */
async function lockUsers(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  for (const id of [...new Set(ids)].sort()) {
    const rows = await tx.$queryRaw<Array<{ wallet_balance_poysha: number }>>`SELECT wallet_balance_poysha FROM users WHERE id = ${id}::uuid FOR UPDATE`;
    balances.set(id, rows[0]?.wallet_balance_poysha ?? 0);
  }
  return balances;
}

/**
 * Settle a completed ride inside the completion transaction (caller holds pool -> ride locks).
 * TeslaPay: debit the passenger, credit the driver (both ledger rows are unique per ride, so a
 * retry can never double-charge). If the balance is somehow insufficient at drop-off, the ride
 * still completes and is settled as cash, with the reason recorded; a completed trip must not fail.
 */
export async function settleRide(tx: Tx, ride: RideRequest, driverId: string, farePoysha: number): Promise<Settlement> {
  const requestedMethod = ride.paymentMethod;
  let method: PaymentMethod = requestedMethod;
  let note: string | null = null;

  if (requestedMethod === 'TESLAPAY' && farePoysha > 0) {
    const balances = await lockUsers(tx, [ride.passengerId, driverId]);
    const balance = balances.get(ride.passengerId) ?? 0;
    if (balance < farePoysha) {
      method = 'CASH';
      note = `TeslaPay balance ${balance} poysha was below the fare ${farePoysha} poysha at drop-off; settled as cash.`;
      logger.warn('payment.wallet_fallback_to_cash', { rideRequestId: ride.id, balance, farePoysha });
    } else {
      await tx.walletTransaction.create({ data: { userId: ride.passengerId, rideRequestId: ride.id, type: 'RIDE_PAYMENT', amountPoysha: -farePoysha } });
      await tx.walletTransaction.create({ data: { userId: driverId, rideRequestId: ride.id, type: 'RIDE_EARNING', amountPoysha: farePoysha } });
    }
  }
  await tx.payment.create({ data: { rideRequestId: ride.id, passengerId: ride.passengerId, driverId, method, amountPoysha: farePoysha } });
  return { method, requestedMethod, amountPoysha: farePoysha, note };
}

export class WalletService {
  constructor(private readonly prisma: PrismaClient) {}

  async balance(userId: string): Promise<number> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalancePoysha: true } });
    return u.walletBalancePoysha;
  }

  async topUp(userId: string, amountPoysha: number) {
    return withTransaction(this.prisma, async (tx) => {
      const txRow = await tx.walletTransaction.create({ data: { userId, type: 'TOP_UP', amountPoysha } });
      logger.info('wallet.top_up', { event: 'WALLET_TOP_UP', amountPoysha });
      return txRow;
    });
  }

  async history(userId: string, page: number, limit: number) {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    return { items, total };
  }
}

export function isInsufficientFunds(err: unknown): boolean {
  return err instanceof Error && err.message.includes('TESLAPOOL_INSUFFICIENT_FUNDS');
}

export function insufficientBalance(required: number, balance: number) {
  return new AppError(422, ErrorCode.INSUFFICIENT_WALLET_BALANCE, 'Your TeslaPay balance is too low for this ride. Top up or pay cash.', { requiredPoysha: required, balancePoysha: balance });
}

