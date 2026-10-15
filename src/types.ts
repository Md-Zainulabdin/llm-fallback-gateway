/** Provider-agnostic chat request accepted by the router. */
export interface UnifiedRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** Ordered list of providers to try; falls back to all registered providers when omitted. */
  providerPriority?: string[];
  /** Maximum time allowed per provider attempt (milliseconds). */
  timeoutMs?: number;
}

export interface ProviderResponse {
  id: string;
  content: string;
  provider: string;
  modelUsed: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export interface ProviderAdapter {
  readonly name: string;
  execute(request: UnifiedRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}