import { logger } from '../common/logger';
import { counters } from '../common/metrics';
import { ModelFeatureSnapshot } from './features';

/**
 * Inference boundary. The domain depends on this interface only; it never sees
 * sklearn, HTTP, or model internals.
 */
export interface MlRawPrediction {
  eta: { modelName: string; modelVersion: string; predictedDurationMin: number };
  fare: { modelName: string; modelVersion: string; predictedFareBdt: number };
  latencyMs: number;
}

export interface MlPredictor {
  readonly enabled: boolean;
  predict(snapshot: ModelFeatureSnapshot): Promise<MlRawPrediction>;
  health(): Promise<{ status: 'up' | 'down' | 'disabled'; detail?: unknown }>;
}

export class MlUnavailableError extends Error {
  constructor(reason: string) {
    super(`ML prediction unavailable: ${reason}`);
  }
}

/** Used when ML_SIDECAR_URL is not configured: every prediction falls back deterministically. */
export class DisabledMlPredictor implements MlPredictor {
  readonly enabled = false;
  async predict(): Promise<MlRawPrediction> {
    throw new MlUnavailableError('ML sidecar not configured');
  }
  async health() {
    return { status: 'disabled' as const };
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * HTTP client for the Python sidecar, with a hard timeout and a simple circuit
 * breaker: after a failure it stops calling for `cooldownMs`, so an ML outage
 * costs one timeout, not one timeout per ride request.
 */
export class HttpMlPredictor implements MlPredictor {
  readonly enabled = true;
  private openUntil = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async predict(snapshot: ModelFeatureSnapshot): Promise<MlRawPrediction> {
    if (this.now() < this.openUntil) throw new MlUnavailableError('circuit open after a recent failure');
    const started = this.now();
    try {
      const res = await fetch(new URL('/v1/predict', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new MlUnavailableError(`sidecar responded ${res.status}`);
      const body = (await res.json()) as Partial<MlRawPrediction>;
      // Validate the shape: a malformed response is treated exactly like an outage.
      if (
        !body.eta || !body.fare ||
        !isFiniteNumber(body.eta.predictedDurationMin) || !isFiniteNumber(body.fare.predictedFareBdt) ||
        typeof body.eta.modelVersion !== 'string' || typeof body.fare.modelVersion !== 'string'
      ) {
        throw new MlUnavailableError('malformed sidecar response');
      }
      return {
        eta: { modelName: String(body.eta.modelName ?? 'eta'), modelVersion: body.eta.modelVersion, predictedDurationMin: body.eta.predictedDurationMin },
        fare: { modelName: String(body.fare.modelName ?? 'fare'), modelVersion: body.fare.modelVersion, predictedFareBdt: body.fare.predictedFareBdt },
        latencyMs: this.now() - started,
      };
    } catch (err) {
      this.openUntil = this.now() + this.cooldownMs;
      counters.mlFailures++;
      const reason = err instanceof MlUnavailableError ? err.message : (err as Error).name === 'TimeoutError' ? 'timeout' : 'connection failed';
      logger.warn('ml.prediction_failed', { event: 'ML_PREDICTION_UNAVAILABLE', reason, cooldownMs: this.cooldownMs });
      throw err instanceof MlUnavailableError ? err : new MlUnavailableError(reason);
    }
  }

  async health() {
    try {
      const res = await fetch(new URL('/health', this.baseUrl), { signal: AbortSignal.timeout(this.timeoutMs) });
      return res.ok ? { status: 'up' as const, detail: await res.json() } : { status: 'down' as const, detail: { httpStatus: res.status } };
    } catch {
      return { status: 'down' as const };
    }
  }
}
