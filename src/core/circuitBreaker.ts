export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number; // consecutive failures needed to trip the breaker OPEN
  cooldownMs: number;       // how long the breaker stays OPEN before probing again
}

export interface CircuitBreakerStats {
  state: CircuitState;
  consecutiveFailures: number;
  lastStateChange: string;
}

/**
 * Prevents calls to a provider that is known to be failing.
 *
 * CLOSED   -> healthy, requests flow through.
 * OPEN     -> unhealthy, requests are fast-failed for `cooldownMs`.
 * HALF-OPEN -> cooldown expired, a single probe request is allowed through;
 *              success closes the breaker, failure re-opens it.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures: number = 0;
  private lastStateChange: number = Date.now();
  private probeInFlight: boolean = false;

  constructor(
    public readonly providerName: string,
    private readonly config: CircuitBreakerConfig = { failureThreshold: 3, cooldownMs: 10000 }
  ) {}

  getState(): CircuitState {
    const now = Date.now();

    // Check if OPEN cooldown period has expired to attempt recovery
    if (this.state === 'OPEN' && now - this.lastStateChange >= this.config.cooldownMs) {
      this.state = 'HALF-OPEN';
      this.lastStateChange = now;
    }

    return this.state;
  }

  /**
   * Returns true if a request may be sent now.
   *
   * In HALF-OPEN this call also claims the single probe slot: only the first
   * caller gets true, everyone else fast-fails until that probe records a
   * success or failure. This keeps concurrent traffic from hammering a
   * provider that is still recovering.
   */
  canExecute(): boolean {
    const currentState = this.getState();

    if (currentState === 'CLOSED') return true;

    if (currentState === 'HALF-OPEN') {
      if (this.probeInFlight) return false;
      this.probeInFlight = true;
      return true;
    }

    return false;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
    if (this.state === 'HALF-OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
    }
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.probeInFlight = false;
    if (this.consecutiveFailures >= this.config.failureThreshold || this.state === 'HALF-OPEN') {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
    }
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      lastStateChange: new Date(this.lastStateChange).toISOString(),
    };
  }
}