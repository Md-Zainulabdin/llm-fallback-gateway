import { ProviderAdapter, ProviderResponse, UnifiedRequest } from '../types';

/**
 * Fake provider used by the demo server and tests.
 * Simulates network latency and, optionally, hard upstream failures
 * without ever calling a real LLM API.
 */
export class MockAdapter implements ProviderAdapter {
  constructor(
    public readonly name: string,
    private readonly mockModel: string,
    private readonly simulatedLatencyMs: number = 200,
    private readonly shouldFail: boolean = false
  ) {}

  async execute(request: UnifiedRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const startTime = Date.now();

    await this.simulateLatency(signal);

    if (this.shouldFail) {
      throw new Error(`[${this.name}] upstream provider returned 500 Internal Server Error`);
    }

    const promptTokens = Math.floor(request.prompt.length / 4);
    const completionTokens = 25;

    return {
      id: `resp_${Math.random().toString(36).slice(2, 9)}`,
      content: `Response from ${this.name}: processed "${request.prompt}"`,
      provider: this.name,
      modelUsed: this.mockModel,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  /** Waits for the simulated delay, or rejects early if the caller aborts. */
  private simulateLatency(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error(`[${this.name}] request aborted`));
        return;
      }

      let timer: NodeJS.Timeout;

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error(`[${this.name}] request aborted: timed out`));
      };

      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, this.simulatedLatencyMs);

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
