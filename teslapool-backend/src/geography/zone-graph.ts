import { Zone, ZONES } from './zones';

/**
 * Deterministic zone model of Dhaka. NOT GPS routing.
 *
 * Two layers, deliberately separate:
 *
 *  1. ADJACENCY (directed edges): which zones border each other. Used for hop
 *     counts, i.e. the coarse "is this pickup/destination nearby?" rules.
 *     Per the spec: Banani -> Gulshan1 = 1 hop, Gulshan1 -> Mohakhali = 1 hop,
 *     Banani -> Mohakhali = 2 hops.
 *
 *  2. ROAD DISTANCE (km): approximate driving distance. Adjacent edges carry a
 *     distance, and a few non-adjacent pairs have a direct road that is shorter
 *     than going through the neighbouring zone (Banani -> Mohakhali ~3.4 km
 *     directly vs 4.5 km via Gulshan). Pair distance = shortest path over both.
 *
 * All values are approximations for the MVP and are labelled ZONE_GRAPH_DISTANCE
 * everywhere they surface. A real routing provider can replace this behind the
 * DistanceProvider interface without touching the pool engine.
 */

export const DISTANCE_SOURCE = {
  ZONE_GRAPH: 'ZONE_GRAPH_DISTANCE',
  REAL_ROUTE: 'REAL_ROUTE_DISTANCE',
  /** What-if value sent to the prediction endpoints; never used for rides, matching or pricing. */
  CLIENT_SUPPLIED: 'CLIENT_SUPPLIED_DISTANCE',
} as const;
export type DistanceSource = (typeof DISTANCE_SOURCE)[keyof typeof DISTANCE_SOURCE];

type Edge = readonly [Zone, Zone, number];

/** Bidirectional adjacency (both directions are added). One-way links could be added as directed edges. */
const ADJACENT: Edge[] = [
  ['BANANI', 'GULSHAN', 2.5],
  ['GULSHAN', 'MOHAKHALI', 2.0],
  ['GULSHAN', 'BASHUNDHARA_RA', 4.0],
  ['BANANI', 'UTTARA', 11.0],
  ['BANANI', 'MIRPUR', 6.0],
  ['MOHAKHALI', 'FARMGATE', 3.5],
  ['FARMGATE', 'DHANMONDI', 2.5],
  ['FARMGATE', 'MIRPUR', 6.5],
  ['FARMGATE', 'MOTIJHEEL', 4.5],
  ['DHANMONDI', 'AZIMPUR', 2.5],
  ['AZIMPUR', 'MOTIJHEEL', 3.5],
  ['UTTARA', 'BASHUNDHARA_RA', 8.0],
  ['UTTARA', 'MIRPUR', 9.0],
];

/** Direct roads between NON-adjacent zones: affect distance, never hop counts. */
const DIRECT_ROADS: Edge[] = [['BANANI', 'MOHAKHALI', 3.4]];

export interface ZoneGraph {
  hops(from: Zone, to: Zone): number;
  distanceKm(from: Zone, to: Zone): number;
  neighbours(zone: Zone): Zone[];
}

function buildGraph(adjacent: Edge[], directRoads: Edge[]): ZoneGraph {
  const adjacency = new Map<Zone, Map<Zone, number>>();
  const roads = new Map<Zone, Map<Zone, number>>();
  for (const z of ZONES) {
    adjacency.set(z, new Map());
    roads.set(z, new Map());
  }
  const addRoad = (a: Zone, b: Zone, km: number) => {
    const current = roads.get(a)!.get(b);
    if (current === undefined || km < current) roads.get(a)!.set(b, km);
  };
  for (const [a, b, km] of adjacent) {
    adjacency.get(a)!.set(b, km);
    adjacency.get(b)!.set(a, km);
    addRoad(a, b, km);
    addRoad(b, a, km);
  }
  for (const [a, b, km] of directRoads) {
    addRoad(a, b, km);
    addRoad(b, a, km);
  }

  // Precompute all pairs once (10 zones): BFS for hops, Dijkstra for km.
  const hopTable = new Map<string, number>();
  const kmTable = new Map<string, number>();
  for (const src of ZONES) {
    const hopDist = new Map<Zone, number>([[src, 0]]);
    const queue: Zone[] = [src];
    while (queue.length) {
      const z = queue.shift()!;
      for (const n of adjacency.get(z)!.keys()) {
        if (!hopDist.has(n)) {
          hopDist.set(n, hopDist.get(z)! + 1);
          queue.push(n);
        }
      }
    }

    const km = new Map<Zone, number>(ZONES.map((z) => [z, Number.POSITIVE_INFINITY]));
    km.set(src, 0);
    const done = new Set<Zone>();
    while (done.size < ZONES.length) {
      let best: Zone | null = null;
      for (const z of ZONES) if (!done.has(z) && (best === null || km.get(z)! < km.get(best)!)) best = z;
      if (best === null || km.get(best) === Number.POSITIVE_INFINITY) break;
      done.add(best);
      for (const [n, w] of roads.get(best)!) {
        const candidate = km.get(best)! + w;
        if (candidate < km.get(n)!) km.set(n, candidate);
      }
    }

    for (const dst of ZONES) {
      hopTable.set(`${src}>${dst}`, hopDist.get(dst) ?? Number.POSITIVE_INFINITY);
      kmTable.set(`${src}>${dst}`, Math.round(km.get(dst)! * 100) / 100);
    }
  }

  return {
    hops: (from, to) => hopTable.get(`${from}>${to}`)!,
    distanceKm: (from, to) => kmTable.get(`${from}>${to}`)!,
    neighbours: (zone) => [...adjacency.get(zone)!.keys()],
  };
}

export const dhakaZoneGraph: ZoneGraph = buildGraph(ADJACENT, DIRECT_ROADS);
