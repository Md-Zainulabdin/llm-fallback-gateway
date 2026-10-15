/**
 * In-process telemetry for the gateway.
 * Keeps a rolling window of the last 1000 latencies so percentile
 * calculations stay cheap.
 */
export class MetricsCollector {
  private totalRequests = 0;
  private totalFailures = 0;
  private fastFails = 0;
  private latenciesMs: number[] = [];

  recordRequest(latencyMs: number, success: boolean, fastFailed: boolean = false): void {
    this.totalRequests++;
    if (!success) this.totalFailures++;
    if (fastFailed) this.fastFails++;

    this.latenciesMs.push(latencyMs);
    if (this.latenciesMs.length > 1000) {
      this.latenciesMs.shift();
    }
  }

  getPercentile(percentile: number): number {
    if (this.latenciesMs.length === 0) return 0;

    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    // Nearest-rank: 1-based rank of ceil(p/100 * N), converted to a 0-based index.
    const rank = Math.ceil((percentile / 100) * sorted.length);
    const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
    return sorted[index];
  }

  getSummary() {
    return {
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      // Requests that skipped an unhealthy provider without waiting for a timeout
      fastFails: this.fastFails,
      errorRatePercent:
        this.totalRequests > 0
          ? Number(((this.totalFailures / this.totalRequests) * 100).toFixed(2))
          : 0,
      p50LatencyMs: this.getPercentile(50),
      p95LatencyMs: this.getPercentile(95),
      p99LatencyMs: this.getPercentile(99),
    };
  }
}
