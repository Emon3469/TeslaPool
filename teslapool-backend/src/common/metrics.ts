/**
 * Minimal in-process operational metrics (single instance, since process start).
 * Deliberately not a metrics stack: bounded ring buffers + counters, exposed by
 * GET /api/v1/stats/impact under `operational`. Swap for Prometheus when scaling out.
 */
class LatencyWindow {
  private readonly values: number[] = [];
  private count = 0;
  constructor(private readonly capacity = 1000) {}

  record(ms: number): void {
    if (this.values.length === this.capacity) this.values.shift();
    this.values.push(ms);
    this.count++;
  }

  summary() {
    if (this.values.length === 0) return { samples: 0, p50Ms: null, p95Ms: null, maxMs: null };
    const sorted = [...this.values].sort((a, b) => a - b);
    const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
    return { samples: this.count, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
  }
}

export const counters = {
  matchAttempts: 0,
  matchSucceeded: 0,
  matchRejected: 0,
  /** A candidate looked feasible but lost its seat to a concurrent request inside the transaction. */
  lostRaces: 0,
  /** The database capacity trigger fired (should stay 0 while the application lock works). */
  capacityGuardHits: 0,
  invalidTransitionsRejected: 0,
  mlFailures: 0,
};

export const httpLatency = new LatencyWindow();
export const matchLatency = new LatencyWindow();
const startedAt = new Date();

export function operationalSnapshot() {
  return {
    scope: 'this API instance since process start (in-memory)',
    since: startedAt.toISOString(),
    http: httpLatency.summary(),
    matching: { ...matchLatency.summary(), attempts: counters.matchAttempts, succeeded: counters.matchSucceeded, rejected: counters.matchRejected },
    concurrency: { lostRaces: counters.lostRaces, capacityGuardHits: counters.capacityGuardHits },
    invalidTransitionsRejected: counters.invalidTransitionsRejected,
    mlFailures: counters.mlFailures,
  };
}
