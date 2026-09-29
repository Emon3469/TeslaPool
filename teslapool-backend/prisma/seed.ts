/**
 * Deterministic, idempotent demo seed using the PRD's story cast. Safe to run on every
 * container start: existing rows (matched by email / registration number) are reused, never duplicated.
 *
 *   8:41 AM, Banani Road 11. Jashim is leaning against Bullet, his three-seat battery-powered
 *   "Tesla". Nusrat books a ride to Mohakhali; Rafiq books Gulshan 1; Shirin tries for the last seat.
 *
 * Seeds accounts, Bullet, TeslaPay balances (as ledger top-ups, so balance == sum of ledger) and,
 * on the first run only, puts Jashim online (an OPEN pool) so the story can start immediately.
 * Rides are created through the API during the demo (docs/demo.md), never pre-baked.
 *
 * Demo credentials, one per role (README "Demo accounts"): SEED_PASSENGER_PASSWORD, SEED_DRIVER_PASSWORD and
 * SEED_ADMIN_PASSWORD, else SEED_PASSWORD, else the documented defaults. Every run re-applies them to the
 * cast, so the published demo logins always work. Cast emails are pre-verified. Demo only.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { config } from '../src/config/env';

interface CastMember {
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  /** Initial simulated TeslaPay balance in poysha. */
  walletPoysha: number;
}

export const CAST: CastMember[] = [
  { name: 'Jashim Uddin', email: 'jashim@teslapool.dev', role: 'DRIVER', phone: '+8801711000001', walletPoysha: 0 },
  { name: 'Nusrat Jahan', email: 'nusrat@teslapool.dev', role: 'PASSENGER', phone: '+8801811000001', walletPoysha: 50_000 },
  { name: 'Rafiq Islam', email: 'rafiq@teslapool.dev', role: 'PASSENGER', phone: '+8801811000002', walletPoysha: 50_000 },
  { name: 'Shirin Akter', email: 'shirin@teslapool.dev', role: 'PASSENGER', phone: '+8801811000003', walletPoysha: 30_000 },
  // Fourth rider: with Nusrat and Rafiq he fills Bullet's 3 seats, so Shirin meets a full Tesla.
  { name: 'Arif Hossain', email: 'arif@teslapool.dev', role: 'PASSENGER', phone: '+8801811000004', walletPoysha: 50_000 },
  { name: 'TeslaPool Ops', email: 'ops@teslapool.dev', role: 'ADMIN', phone: '+8801700000000', walletPoysha: 0 },
];

export const BULLET = { driverEmail: 'jashim@teslapool.dev', name: 'Bullet', registrationNumber: 'DHAKA-METRO-TA-11-2233', vehicleType: 'AUTO_RICKSHAW' as const, capacity: 3 };

export async function seed(prisma: PrismaClient): Promise<{ users: number; walletsFunded: number; jashimOnline: boolean }> {
  const hashes = {
    PASSENGER: await hashPassword(config.seedPasswords.PASSENGER),
    DRIVER: await hashPassword(config.seedPasswords.DRIVER),
    ADMIN: await hashPassword(config.seedPasswords.ADMIN),
  };
  const ids = new Map<string, string>();
  let walletsFunded = 0;

  for (const m of CAST) {
    const passwordHash = hashes[m.role];
    const existing = await prisma.user.findUnique({ where: { email: m.email }, select: { emailVerifiedAt: true } });
    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: { passwordHash, emailVerifiedAt: existing?.emailVerifiedAt ?? new Date() },
      create: { name: m.name, email: m.email, role: m.role, phone: m.phone, passwordHash, emailVerifiedAt: new Date() },
    });
    ids.set(m.email, user.id);
    // Fund once: only when this user has no ledger history yet (the DB trigger moves the balance).
    if (m.walletPoysha > 0 && (await prisma.walletTransaction.count({ where: { userId: user.id } })) === 0) {
      await prisma.walletTransaction.create({ data: { userId: user.id, type: 'TOP_UP', amountPoysha: m.walletPoysha } });
      walletsFunded++;
    }
  }

  const jashimId = ids.get(BULLET.driverEmail)!;
  const bullet = await prisma.vehicle.upsert({
    where: { registrationNumber: BULLET.registrationNumber },
    update: {},
    create: { driverId: jashimId, name: BULLET.name, registrationNumber: BULLET.registrationNumber, vehicleType: BULLET.vehicleType, capacity: BULLET.capacity },
  });

  // First run only: Jashim is waiting at Banani with Bullet (online = an OPEN pool).
  let jashimOnline = false;
  if ((await prisma.pool.count({ where: { driverId: jashimId } })) === 0) {
    await prisma.pool.create({ data: { vehicleId: bullet.id, driverId: jashimId, capacity: bullet.capacity } });
    jashimOnline = true;
  }
  return { users: CAST.length, walletsFunded, jashimOnline };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((r) => console.log(`Seed complete: ${r.users} cast members (Jashim + Bullet, Nusrat, Rafiq, Shirin, Arif, Ops), ${r.walletsFunded} wallets funded${r.jashimOnline ? ', Jashim online with Bullet' : ''}. Demo passwords: see README "Demo accounts".`))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
