import type { components } from './api-types';

export type Schemas = components['schemas'];
export type User = Schemas['User'];
export type Role = User['role'];
export type Money = Schemas['Money'];
export type Ride = Schemas['Ride'];
export type RideStatus = Ride['status'];
export type RidePhase = Ride['phase'];
export type Pool = Schemas['Pool'];
export type PoolPassenger = Pool['passengers'][number];
export type MatchDecision = Schemas['MatchDecision'];
export type CompatibleRequest = Schemas['CompatibleRequest'];
export type Meta = Schemas['Meta'];
export type Zone = Meta['zones'][number];
export type Wallet = Schemas['Wallet'];
export type WalletTransaction = Schemas['WalletTransaction'];
export type Vehicle = Schemas['Vehicle'];
export type ImpactStats = Schemas['ImpactStats'];
export type AutoMatchResult = Schemas['AutoMatchResult'];
export type CreateRideRequest = Schemas['CreateRideRequest'];
export type ZoneCode = CreateRideRequest['pickupZone'];
export type VehicleType = Vehicle['vehicleType'];
export type PaymentMethod = Ride['paymentMethod'];

/** `GET /driver/status` returns the pool as a loose object; it is the same shape as `Pool`. */
export type DriverStatus = Omit<Schemas['DriverStatus'], 'pool'> & { pool: Pool | null };

export type CreatedRide = Ride & { quote: RideQuote; poolOptions: MatchDecision[] };

/** The quote objects are untyped in the OpenAPI document; these mirror `PredictionResult` on the API. */
export interface EtaDecision {
  finalMinutes: number;
  deterministicMinutes: number;
  mlPredictedMinutes: number | null;
  source: 'ML' | 'DETERMINISTIC';
  reason: 'ML_WITHIN_GUARDRAIL' | 'ETA_GUARDRAIL_TRIGGERED' | 'ML_PREDICTION_UNAVAILABLE';
  modelVersion: string | null;
}

export interface FareDecision {
  pricingMode: 'deterministic' | 'ml_guarded';
  baselineFarePoysha: number;
  mlPredictedFarePoysha: number | null;
  mlWithinGuardrail: boolean | null;
  guardrailApplied: boolean;
  finalFarePoysha: number;
  source: 'ML' | 'DETERMINISTIC';
  reason: string;
  deviationBps: number | null;
  allowedBand: { minPoysha: number; maxPoysha: number };
  modelVersion: string | null;
}

export interface RideQuote {
  mlAvailable: boolean;
  conditions: { traffic?: string; weather?: string; timeOfDay?: string; distanceKm?: number; distanceSource?: string } & Record<string, unknown>;
  eta: EtaDecision;
  fare: FareDecision;
}

export interface ExplanationTrip {
  poolId: string;
  poolStatus: string;
  driverFirstName: string;
  vehicle: { name: string; vehicleType: string; registrationNumber: string };
  route: string[];
  yourPickup: { zone: string; name: string; stopNumber: number };
  yourDropoff: { zone: string; name: string; stopNumber: number };
  yourDetourKm: number;
  coPassengers: { firstName: string; seats: number; pickup: string; dropoff: string }[];
}

export interface ExplanationFare {
  currency: 'BDT';
  standard: {
    base: Money;
    distanceCharge: Money;
    timeCharge: Money;
    total: Money;
    distanceKm: number;
    pricingDurationMinutes: number;
    trafficLevel: string;
  } | null;
  quote: { amount: Money; source: string; decision: FareDecision | null; eta: EtaDecision | null };
  pooled: { soloFare: Money; fare: Money; saving: Money; sharedPercent: number; discountPercent: number; locked: boolean } | null;
  final: Money | null;
  paymentMethod: PaymentMethod;
  payment: { method: PaymentMethod; amount: Money; settledAt: string } | null;
  lines: string[];
}

export type RideExplanation = Omit<Schemas['RideExplanation'], 'trip' | 'fare'> & { trip: ExplanationTrip | null; fare: ExplanationFare };

export type PredictionRequest = Schemas['PredictionRequest'];
export type EtaPrediction = Schemas['EtaPrediction'];
export type FarePrediction = Schemas['FarePrediction'];
export type RideEvent = Schemas['RideEvent'];

export interface Health {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}

export interface Readiness {
  status: string;
  version?: string;
  checks: Record<string, { status: string; latencyMs?: number; fallback?: string; [k: string]: unknown }>;
}
