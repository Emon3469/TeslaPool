import { DISTANCE_SOURCE, DistanceSource, dhakaZoneGraph, ZoneGraph } from './zone-graph';
import { Zone } from './zones';

/**
 * The pool engine and fare engine depend only on this interface. Swapping in a
 * real routing API later means a new implementation with source REAL_ROUTE_DISTANCE
 * (and a cache, since the engine evaluates many stop orders per request).
 */
export interface DistanceProvider {
  readonly source: DistanceSource;
  distanceKm(from: Zone, to: Zone): number;
  /** Symmetric proximity in zone hops: min(hops(a,b), hops(b,a)). */
  proximityHops(a: Zone, b: Zone): number;
}

export class ZoneGraphDistanceProvider implements DistanceProvider {
  readonly source = DISTANCE_SOURCE.ZONE_GRAPH;

  constructor(private readonly graph: ZoneGraph = dhakaZoneGraph) {}

  distanceKm(from: Zone, to: Zone): number {
    return this.graph.distanceKm(from, to);
  }

  proximityHops(a: Zone, b: Zone): number {
    return Math.min(this.graph.hops(a, b), this.graph.hops(b, a));
  }
}
