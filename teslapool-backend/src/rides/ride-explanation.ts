import type { Payment, PoolMembership, PrismaClient, RideEvent, RideRequest } from '@prisma/client';
import type { FareRates } from '../config/env';
import type { AuthPrincipal } from '../common/express-augment';
import { FareDecision, formatBdt, money } from '../fares/fare-engine';
import { ZONE_INFO, type Zone } from '../geography/zones';
import { routeLabel } from '../pools/explain';
import type { MatchDecision } from '../pools/matching-engine';
import type { EtaDecision } from '../predictions/prediction.service';
import type { RideService } from './rides.service';

/**
 * "Explain my ride": answers, in plain language and from stored facts only,
 *   1. why was I matched (or not) with these passengers,
 *   2. why do I pay this amount,
 *   3. what happened, in order.
 * Everything is derived from the immutable event log and the membership row;
 * nothing is re-computed with today's configuration.
 */

const place = (z: string) => ZONE_INFO[z as Zone]?.displayName ?? z;
const pct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

type Meta = Record<string, unknown> | null;
const meta = (e: RideEvent) => (e.metadata ?? null) as Meta;

function describeEvent(e: RideEvent): string {
  const m = meta(e) ?? {};
  switch (e.eventType) {
    case 'RIDE_REQUESTED':
      return 'Ride requested';
    case 'MATCH_REJECTED': {
      const d = m.decision as Partial<MatchDecision> & { reasonCodes?: string[] };
      return d?.headline ?? `No compatible pool (${(d?.reasonCodes ?? []).join(', ') || 'unknown'})`;
    }
    case 'ROUTE_UPDATED': {
      const fare = m.farePoysha as { before: number; after: number } | undefined;
      const detour = m.detourKm as { before: number; after: number } | undefined;
      const who = m.cause === 'JOIN' ? 'Another passenger joined' : 'A passenger left';
      const parts = [who];
      if (fare && fare.before !== fare.after) parts.push(`your fare ${formatBdt(fare.before)} → ${formatBdt(fare.after)}`);
      if (detour && detour.before !== detour.after) parts.push(`your detour ${detour.before} → ${detour.after} km`);
      if (Array.isArray(m.route)) parts.push(`route ${routeLabel(m.route as string[])}`);
      return parts.join('; ');
    }
    case 'STATUS_CHANGED':
      switch (m.cause) {
        case 'POOL_JOINED': return 'Joined a pool';
        case 'DRIVER_ACCEPTED': return 'Driver accepted your request into their pool';
        case 'POOL_LEFT': return 'Left the pool (back to searching)';
        case 'DRIVER_ARRIVED': return 'Driver arrived at pickup';
        case 'STARTED': return 'Trip started (fare locked)';
        case 'COMPLETED': return `Trip completed${typeof m.finalFarePoysha === 'number' ? `, charged ${formatBdt(m.finalFarePoysha)}` : ''}`;
        case 'CANCELLED': return `Cancelled${m.reason ? `: ${String(m.reason)}` : ''}`;
        default: return `${e.fromStatus ?? '∅'} → ${e.toStatus ?? '?'}`;
      }
    default:
      return e.eventType;
  }
}

function quoteLine(fare: FareDecision): string {
  const band = `${formatBdt(fare.allowedBand.minPoysha)}–${formatBdt(fare.allowedBand.maxPoysha)}`;
  switch (fare.reason) {
    case 'DETERMINISTIC_PRICING':
      return fare.mlPredictedFarePoysha === null
        ? 'Priced by the standard formula (the fare model was unavailable; it never sets the price in this pricing mode).'
        : `Priced by the standard formula. For reference, fare model ${fare.modelVersion} estimated ${formatBdt(fare.mlPredictedFarePoysha)}${fare.mlWithinGuardrail ? ' (within' : ' (outside'} the ±band ${band}); the model never sets the price in this pricing mode.`;
    case 'ML_WITHIN_GUARDRAIL':
      return `Fare model ${fare.modelVersion} estimated ${formatBdt(fare.finalFarePoysha)}, inside the allowed band ${band} around the standard fare ${formatBdt(fare.baselineFarePoysha)}, so the model's estimate was used.`;
    case 'FARE_GUARDRAIL_TRIGGERED':
      return `Fare model ${fare.modelVersion} suggested ${formatBdt(fare.mlPredictedFarePoysha ?? 0)}, outside the allowed band ${band}, so the standard fare ${formatBdt(fare.baselineFarePoysha)} was used.`;
    case 'ML_PREDICTION_UNAVAILABLE':
      return 'The fare model was unavailable, so the standard fare was quoted.';
  }
}

export class RideExplanationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rides: RideService,
    private readonly rates: FareRates,
  ) {}

  private async build(actor: AuthPrincipal, rideId: string) {
    const ride = await this.rides.getVisible(actor, rideId);
    const events = await this.prisma.rideEvent.findMany({ where: { rideRequestId: rideId }, orderBy: { seq: 'asc' } });
    const membership = ride.memberships.find((m) => m.status === 'ACTIVE' || m.status === 'COMPLETED') ?? null;

    const requested = events.find((e) => e.eventType === 'RIDE_REQUESTED');
    const quote = (meta(requested!) ?? {}) as { fare?: FareDecision; eta?: EtaDecision };
    const joinEvent = [...events].reverse().find((e) => e.eventType === 'STATUS_CHANGED' && e.toStatus === 'MATCHED');
    const joinDecision = (joinEvent && (meta(joinEvent)?.decision as MatchDecision | undefined)) ?? null;

    return {
      rideRequestId: ride.id,
      status: ride.status,
      summary: [] as string[],
      match: joinDecision && joinEvent && membership
        ? {
            headline: joinDecision.headline,
            matchedAt: joinEvent.createdAt.toISOString(),
            initiatedBy: meta(joinEvent)?.cause === 'DRIVER_ACCEPTED' ? 'DRIVER' : 'PASSENGER',
            reasons: joinDecision.checks.map((c) => ({ rule: c.rule, passed: c.passed, message: c.message })),
            routeAtMatch: joinDecision.route ?? [],
            detourKmAtMatch: joinDecision.detourKm ?? 0,
          }
        : null,
      trip: membership ? await this.trip(ride, membership) : null,
      fare: this.fare(ride, membership, quote.fare ?? null, quote.eta ?? null),
      rejections: events
        .filter((e) => e.eventType === 'MATCH_REJECTED')
        .map((e) => {
          const d = meta(e)?.decision as (Partial<MatchDecision> & { reasonCodes?: string[] }) | undefined;
          return {
            at: e.createdAt.toISOString(),
            poolId: e.poolId,
            headline: describeEvent(e),
            reasons: (d?.checks ?? []).filter((c) => !c.passed).map((c) => c.message),
            reasonCodes: d?.reasonCodes ?? [],
          };
        }),
      timeline: events.map((e) => ({ at: e.createdAt.toISOString(), eventType: e.eventType, from: e.fromStatus, to: e.toStatus, description: describeEvent(e) })),
    };
  }

  /** Human summary lines are built last from the structured parts. */
  async explain(actor: AuthPrincipal, rideId: string) {
    const x = await this.build(actor, rideId);
    const lines: string[] = [];
    if (x.trip) {
      const others = x.trip.coPassengers.map((p) => p.firstName);
      lines.push(others.length ? `Sharing with ${others.join(', ')}` : 'Riding alone in this pool so far');
      lines.push(`Route: ${routeLabel(x.trip.route)}`);
    } else if (x.rejections.length) {
      lines.push(x.rejections[x.rejections.length - 1].headline);
    } else {
      lines.push('Waiting for a compatible pool');
    }
    lines.push(...x.fare.lines.slice(-1));
    x.summary = lines;
    return x;
  }

  private async trip(ride: RideRequest, m: PoolMembership) {
    const pool = await this.prisma.pool.findUniqueOrThrow({
      where: { id: m.poolId },
      include: {
        vehicle: { select: { name: true, vehicleType: true, registrationNumber: true } },
        driver: { select: { name: true } },
        memberships: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } }, include: { passenger: { select: { name: true } }, rideRequest: { select: { dropoffZone: true, pickupZone: true } } } },
      },
    });
    const route = pool.plannedStops as string[];
    return {
      poolId: pool.id,
      poolStatus: pool.status,
      driverFirstName: pool.driver.name.split(' ')[0],
      vehicle: pool.vehicle,
      route,
      yourPickup: { zone: ride.pickupZone, name: place(ride.pickupZone), stopNumber: m.pickupSequence + 1 },
      yourDropoff: { zone: ride.dropoffZone, name: place(ride.dropoffZone), stopNumber: m.dropoffSequence + 1 },
      yourDetourKm: m.detourKm,
      coPassengers: pool.memberships
        .filter((o) => o.rideRequestId !== ride.id)
        .map((o) => ({ firstName: o.passenger.name.split(' ')[0], seats: o.seats, pickup: place(o.rideRequest.pickupZone), dropoff: place(o.rideRequest.dropoffZone) })),
    };
  }

  private fare(ride: RideRequest & { payment?: Payment | null }, m: PoolMembership | null, quote: FareDecision | null, eta: EtaDecision | null) {
    // Frozen at request time: the explanation never depends on today's configuration.
    const frozen = ride.baseFarePoysha !== null && ride.distanceChargePoysha !== null && ride.timeChargePoysha !== null;
    const standard = frozen
      ? {
          base: money(ride.baseFarePoysha!),
          distanceCharge: money(ride.distanceChargePoysha!),
          timeCharge: money(ride.timeChargePoysha!),
          total: money(ride.baseFarePoysha! + ride.distanceChargePoysha! + ride.timeChargePoysha!),
          distanceKm: ride.estimatedDistanceKm,
          pricingDurationMinutes: ride.pricingDurationMin!,
          trafficLevel: ride.trafficLevel,
        }
      : null;
    const lines: string[] = [];
    if (standard) {
      lines.push(
        `Standard fare ${formatBdt(standard.total.amountPoysha)} = base ${formatBdt(standard.base.amountPoysha)} + distance ${standard.distanceKm} km (${formatBdt(standard.distanceCharge.amountPoysha)}) + time ${standard.pricingDurationMinutes} min at ${String(standard.trafficLevel).toLowerCase()} traffic (${formatBdt(standard.timeCharge.amountPoysha)}).`,
      );
    }
    if (quote) lines.push(quoteLine(quote));
    const pooled = m
      ? {
          soloFare: money(m.soloFarePoysha),
          fare: money(m.farePoysha),
          saving: money(m.soloFarePoysha - m.farePoysha),
          sharedPercent: Math.round(m.sharedFraction * 1000) / 10,
          discountPercent: m.discountBps / 100,
          locked: ride.status === 'STARTED' || ride.status === 'COMPLETED',
        }
      : null;
    if (m && pooled) {
      lines.push(
        m.discountBps > 0
          ? `You share ${pct(m.sharedFraction)} of your ride, so you get a ${pooled.discountPercent}% pool discount: you pay ${formatBdt(m.farePoysha)} instead of ${formatBdt(m.soloFarePoysha)} (save ${formatBdt(m.soloFarePoysha - m.farePoysha)}).`
          : `No shared riding yet, so no pool discount: you pay ${formatBdt(m.farePoysha)}. The price drops if a compatible passenger joins before pickup.`,
      );
    } else {
      lines.push(`Quoted solo fare ${formatBdt(ride.quotedFarePoysha)}; sharing a pool lowers it by up to ${this.rates.maxDiscountBps / 100}%.`);
    }
    const payment = ride.payment
      ? { method: ride.payment.method, amount: money(ride.payment.amountPoysha), settledAt: ride.payment.settledAt.toISOString() }
      : null;
    if (payment) {
      lines.push(
        payment.method === 'TESLAPAY'
          ? `Paid ${formatBdt(payment.amount.amountPoysha)} from your TeslaPay wallet.`
          : `Paid ${formatBdt(payment.amount.amountPoysha)} in cash to the driver${ride.paymentMethod === 'TESLAPAY' ? ' (TeslaPay balance was insufficient at drop-off)' : ''}.`,
      );
    }
    return {
      currency: 'BDT' as const,
      standard,
      quote: { amount: money(ride.quotedFarePoysha), source: ride.fareSource, decision: quote, eta },
      pooled,
      final: ride.finalFarePoysha === null ? null : money(ride.finalFarePoysha),
      paymentMethod: ride.paymentMethod,
      payment,
      lines,
    };
  }

}
