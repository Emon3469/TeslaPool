import { Zone, ZONE_INFO } from '../geography/zones';

/**
 * Canonical request-time vocabularies (API values) and their exact training-data strings.
 * AUTO_RICKSHAW is the PRD's "Tesla" (Dhaka slang), e.g. Jashim's three-seat "Bullet".
 */
export const VEHICLE_TYPES = ['AUTO_RICKSHAW', 'RICKSHAW', 'BIKE_RIDESHARE'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const TRAFFIC_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'GRIDLOCK'] as const;
export type TrafficLevel = (typeof TRAFFIC_LEVELS)[number];

export const WEATHER = ['CLEAR', 'OVERCAST', 'RAINY'] as const;
export type Weather = (typeof WEATHER)[number];

export const TIMES_OF_DAY = ['MORNING_PEAK', 'EVENING_PEAK', 'OFF_PEAK', 'NIGHT'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

const DATASET_VEHICLE: Record<VehicleType, string> = {
  AUTO_RICKSHAW: 'CNG Auto-Rickshaw',
  RICKSHAW: 'Rickshaw',
  BIKE_RIDESHARE: 'Bike (Ride-share)',
};
const DATASET_TRAFFIC: Record<TrafficLevel, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', GRIDLOCK: 'Gridlock' };
const DATASET_WEATHER: Record<Weather, string> = { CLEAR: 'Clear', OVERCAST: 'Overcast', RAINY: 'Rainy' };
const DATASET_TIME: Record<TimeOfDay, string> = {
  MORNING_PEAK: 'Morning Peak',
  EVENING_PEAK: 'Evening Peak',
  OFF_PEAK: 'Off-Peak',
  NIGHT: 'Night',
};

/** Physical passenger seats per vehicle type (upper bound when registering a vehicle). */
export const VEHICLE_MAX_SEATS: Record<VehicleType, number> = { AUTO_RICKSHAW: 3, RICKSHAW: 2, BIKE_RIDESHARE: 1 };

/** Explicit, closed feature contract. Clients can never send arbitrary feature dictionaries. */
export interface PredictionFeatures {
  vehicleType: VehicleType;
  pickupZone: Zone;
  dropoffZone: Zone;
  distanceKm: number;
  traffic: TrafficLevel;
  weather: Weather;
  timeOfDay: TimeOfDay;
  surgeMultiplier: number;
}

/** The exact payload the ML model receives; persisted verbatim as prediction_events.feature_snapshot. */
export interface ModelFeatureSnapshot {
  Vehicle_Type: string;
  Pickup_Zone: string;
  Dropoff_Zone: string;
  Distance_KM: number;
  Traffic_Condition: string;
  Weather: string;
  Time_of_Day: string;
  Surge_Multiplier: number;
}

export function toModelSnapshot(f: PredictionFeatures): ModelFeatureSnapshot {
  return {
    Vehicle_Type: DATASET_VEHICLE[f.vehicleType],
    Pickup_Zone: ZONE_INFO[f.pickupZone].datasetName,
    Dropoff_Zone: ZONE_INFO[f.dropoffZone].datasetName,
    Distance_KM: f.distanceKm,
    Traffic_Condition: DATASET_TRAFFIC[f.traffic],
    Weather: DATASET_WEATHER[f.weather],
    Time_of_Day: DATASET_TIME[f.timeOfDay],
    Surge_Multiplier: f.surgeMultiplier,
  };
}

/** Server-side request context, used when the client does not state conditions. Dhaka is UTC+6, no DST. */
export function timeOfDayAt(date: Date): TimeOfDay {
  const hour = (date.getUTCHours() + 6) % 24;
  if (hour >= 7 && hour < 11) return 'MORNING_PEAK';
  if (hour >= 17 && hour < 21) return 'EVENING_PEAK';
  if (hour >= 22 || hour < 6) return 'NIGHT';
  return 'OFF_PEAK';
}

export function typicalTraffic(timeOfDay: TimeOfDay): TrafficLevel {
  switch (timeOfDay) {
    case 'MORNING_PEAK':
    case 'EVENING_PEAK':
      return 'HIGH';
    case 'OFF_PEAK':
      return 'MEDIUM';
    case 'NIGHT':
      return 'LOW';
  }
}
