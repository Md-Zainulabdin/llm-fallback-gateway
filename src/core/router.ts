import { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerStats } from './circuitBreaker';
import { ProviderAdapter, ProviderResponse, UnifiedRequest } from '../types';

export interface RouteResult {
  response: ProviderResponse;
  attemptLogs: string[];
  /** True when at least one provider was skipped because its circuit breaker was open. */
  fastFailed: boolean;
}

const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 10_000,
};

/**
 * Routes a unified request through an ordered chain of provider adapters.
 *
 * For each provider in the chain the router:
 *   1. Skips it instantly if its circuit breaker is open (fast-fail).
 *   2. Sends the request with a per-attempt timeout.
 *   3. Records the outcome so the breaker can open/close accordingly.
 *
 * The first successful response wins. If every provider fails, an error
 * containing the full attempt log is thrown.
 */
export class FallbackRouter {
  private readonly breakers: Record<string, CircuitBreaker> = {};

  constructor(
    private readonly adapters: Record<string, ProviderAdapter>,
    breakerConfig: Partial<CircuitBreakerConfig> = {}
  ) {
    const config: CircuitBreakerConfig = { ...DEFAULT_BREAKER_CONFIG, ...breakerConfig };

    for (const providerName of Object.keys(adapters)) {
      this.breakers[providerName] = new CircuitBreaker(providerName, config);
    }
  }

  async routeWithFallback(
    request: UnifiedRequest,
    defaultTimeoutMs: number = 1000
  ): Promise<RouteResult> {
    const attemptLogs: string[] = [];
    const providerChain =
      request.providerPriority && request.providerPriority.length > 0
        ? request.providerPriority
        : Object.keys(this.adapters);

    const perAttemptTimeoutMs = request.timeoutMs || defaultTimeoutMs;
    let fastFailed = false;

    for (const providerName of providerChain) {
      const adapter = this.adapters[providerName];
      const breaker = this.breakers[providerName];

      if (!adapter || !breaker) {
        attemptLogs.push(`SKIPPED  [${providerName}]: no adapter registered`);
        continue;
      }

      // Fast-fail: an open breaker means the provider is known-unhealthy,
      // so move on instantly instead of waiting for another timeout.
      if (!breaker.canExecute()) {
        fastFailed = true;
        attemptLogs.push(`FAST-FAIL [${providerName}]: circuit breaker is OPEN`);
        continue;
      }

      attemptLogs.push(`ATTEMPT  [${providerName}]: breaker is ${breaker.getState()}`);

      try {
        const response = await this.executeWithTimeout(adapter, request, perAttemptTimeoutMs);
        breaker.recordSuccess();
        attemptLogs.push(`SUCCESS  [${providerName}]: responded in ${response.latencyMs}ms`);
        return { response, attemptLogs, fastFailed };
      } catch (error) {
        breaker.recordFailure();
        const reason = error instanceof Error ? error.message : String(error);
        attemptLogs.push(`FAILED   [${providerName}]: ${reason} -> breaker is now ${breaker.getState()}`);
      }
    }

    throw new Error(`All providers in the fallback chain failed:\n${attemptLogs.join('\n')}`);
  }

  /** Snapshot of every provider's circuit breaker, keyed by provider name. */
  getSystemHealth(): Record<string, CircuitBreakerStats> {
    const health: Record<string, CircuitBreakerStats> = {};
    for (const [providerName, breaker] of Object.entries(this.breakers)) {
      health[providerName] = breaker.getStats();
    }
    return health;
  }

  /**
   * Sends the request to one adapter with a hard per-attempt timeout.
   *
   * The timeout is enforced by the router itself (Promise.race), not only by
   * the abort signal, so an adapter that ignores `signal` still cannot stall
   * the fallback chain. The abort is sent as well so cooperative adapters can
   * stop their work early.
   */
  private async executeWithTimeout(
    adapter: ProviderAdapter,
    request: UnifiedRequest,
    timeoutMs: number
  ): Promise<ProviderResponse> {
    const controller = new AbortController();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const attempt = adapter.execute(request, controller.signal);
    // If the timeout wins the race, a late rejection from the adapter must
    // not surface as an unhandled rejection.
    attempt.catch(() => {});

    try {
      return await Promise.race([attempt, timeout]);
    } catch (error) {
      // Normalize the error regardless of which side settled first.
      if (controller.signal.aborted) {
        throw new Error(`timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
