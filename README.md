# LLM Fallback Gateway

This is a small gateway for routing LLM requests across multiple providers. If one provider is slow, down, or rate-limited, the request can move to the next provider instead of failing instantly.

It gives you a simple fallback layer with:

- automatic provider switching
- per-provider circuit breakers
- per-attempt timeouts
- lightweight latency and failure metrics

## Why this exists

Most apps talk to a single LLM provider. That works until that provider has an outage, starts rejecting requests, or becomes slow enough to hurt the user experience.

This project sits in front of your providers and decides where a request should go. It tries providers in order, skips ones that are already known to be unhealthy, and returns the first successful response it can get.

## How it works

A request to `POST /generate` goes through this flow:

1. Guards run first: optional API key check and per-client rate limiting.
   - Rejected requests get `401` or `429`.
2. The request body is checked for validity.
   - Invalid input gets a `400` response.
3. The router looks at `providerPriority` if it was provided.
   - Otherwise it uses the configured provider list.
4. For each provider in order:
   - if the circuit breaker is open, it is skipped immediately
   - otherwise the request is sent with a timeout enforced by the router
   - the result is recorded on that provider's breaker
5. The first successful response is returned with `200`.
   - If every provider fails, the client gets a `502` along with the full attempt log.

### Circuit breaker behavior

Each provider has its own circuit breaker, so one bad provider does not poison the rest.

| State | Meaning | Router behavior |
|---|---|---|
| `CLOSED` | Healthy | Requests go through normally |
| `OPEN` | Known unhealthy | Requests are skipped immediately |
| `HALF-OPEN` | Cooldown finished | One probe request is allowed through; other requests wait |

The breaker opens after 3 consecutive failures. After a 10 second cooldown, it moves into `HALF-OPEN`. If the next probe succeeds, it closes again. If it fails, it flips back to `OPEN`. While that single probe is in flight, concurrent requests are skipped so a recovering provider is not hit with a burst.

This fast-fail behavior matters: if a provider is already failing, the router does not waste time waiting on it.

## Project structure

```text
src/
├── index.ts               Starts the server and wires up providers, router, and metrics
├── config.ts              Runtime config such as port, timeouts, and body limits
├── types.ts               Shared request and response types
├── core/                  Resilience logic without HTTP concerns
│   ├── circuitBreaker.ts  Circuit breaker state machine
│   ├── router.ts          Fallback and timeout handling
│   └── *.test.ts          Unit tests for the router and breaker
├── providers/
│   └── mockAdapter.ts     Fake provider used for local testing
├── http/                  HTTP-facing layer
│   ├── server.ts          Route table and server startup
│   ├── chatHandler.ts     Request validation and response handling
│   ├── request.ts         Request parsing and body validation
│   ├── response.ts        JSON response helpers
│   └── guards.ts          API key check and rate limiting
└── observability/
    └── metrics.ts         Latency and failure tracking
scripts/
└── stressTest.ts          Simulated load test
```

The code is intentionally layered: `http/` depends on `core/`, and the core logic does not import HTTP code. That makes the routing logic easy to test in isolation.

## Getting started

Requirements: Node.js 20.6+.

```bash
npm install
npm start
```

The gateway runs on `http://localhost:3000` by default and binds to `127.0.0.1`, so it is only reachable from your machine. Configuration comes from environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port to listen on |
| `HOST` | `127.0.0.1` | Bind address; set `0.0.0.0` to expose the gateway to other machines |
| `GATEWAY_API_KEY` | unset | When set, every request must include it in an `x-api-key` header |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per-client request budget per minute |

Set `GATEWAY_API_KEY` before pointing billable providers at the gateway. Without it, protection relies on the loopback bind alone.

Useful commands:

```bash
npm run stress       # run a load test against the mock providers
npm test             # run the unit tests
npm run typecheck    # run TypeScript checks
npm run dev          # start with file watching
PORT=8080 npm start  # run on a custom port
```

## API reference

### `POST /generate`

Example request:

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Say hello",
    "providerPriority": ["mock-failing", "mock-backup"],
    "timeoutMs": 500
  }'
```

Request fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | yes | The main user message |
| `systemPrompt` | string | no | Optional system instructions |
| `providerPriority` | string[] | no | Ordered providers to try; defaults to all registered providers |
| `timeoutMs` | number | no | Per-attempt timeout in milliseconds; default is `1000` |
| `maxTokens` | number | no | Passed through to the provider |
| `temperature` | number | no | A value between `0` and `2` |

Example successful response:

```json
{
  "id": "resp_a1b2c3d",
  "content": "Response from mock-backup: processed \"Say hello\"",
  "provider": "mock-backup",
  "modelUsed": "mock-gemini-1-5",
  "usage": { "promptTokens": 2, "completionTokens": 25, "totalTokens": 27 },
  "latencyMs": 84,
  "meta": {
    "attemptLogs": [
      "ATTEMPT  [mock-failing]: breaker is CLOSED",
      "FAILED   [mock-failing]: upstream provider returned 500 -> breaker is now CLOSED",
      "ATTEMPT  [mock-backup]: breaker is CLOSED",
      "SUCCESS  [mock-backup]: responded in 84ms"
    ],
    "totalLatencyMs": 141
  }
}
```

The `attemptLogs` field is useful during debugging because it shows exactly what happened at each provider.

Error responses:

| Status | Meaning |
|---|---|
| `400` | Missing or invalid fields, or malformed JSON |
| `401` | `GATEWAY_API_KEY` is set and the `x-api-key` header is missing or wrong |
| `404` | Route not found |
| `405` | Wrong HTTP method |
| `413` | Request body is too large |
| `429` | Rate limit exceeded; the response carries a `Retry-After` header |
| `502` | Every provider failed; the response includes the full attempt log |

### `GET /health`

This endpoint returns the current breaker state for each provider:

```json
{
  "mock-failing": {
    "state": "OPEN",
    "consecutiveFailures": 3,
    "lastStateChange": "2026-10-09T16:08:09.500Z"
  }
}
```

### `GET /metrics`

```json
{
  "totalRequests": 50,
  "totalFailures": 0,
  "fastFails": 47,
  "errorRatePercent": 0,
  "p50LatencyMs": 158,
  "p95LatencyMs": 176,
  "p99LatencyMs": 176
}
```

`fastFails` counts requests where an open breaker was skipped before any network call was made. That is the latency the request did not pay for.

## Demo walkthrough

With the server running, try this:

```bash
npm run stress
npm run stress
```

The second run should happen within the 10 second recovery window.

What you will see:

1. First run: the failing provider gets tripped and the requests still succeed through the fallback provider.
2. Second run: the failing provider is already open, so the router skips it immediately.
3. Metrics reflect that behavior: more requests become `fastFails`, and the latency drops.

## Adding a provider

Implement the `ProviderAdapter` interface:

```ts
export interface ProviderAdapter {
  readonly name: string;
  execute(request: UnifiedRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}
```

Two important rules:

1. Respect the `signal` argument and abort your HTTP request when the timeout is reached.
2. Throw on failure. Non-2xx responses and network errors should reject so the router can record them as breaker failures.

Example:

```ts
// src/providers/openaiAdapter.ts
export class OpenAIAdapter implements ProviderAdapter {
  readonly name = 'openai';

  async execute(request: UnifiedRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: request.prompt }],
      }),
    });

    if (!res.ok) throw new Error('OpenAI responded with ' + res.status);
    // map the result to ProviderResponse
  }
}
```

The project does not load `.env` files, so export the key in the shell that starts the gateway:

```bash
export OPENAI_API_KEY=sk-...    # macOS / Linux
$env:OPENAI_API_KEY = "sk-..."  # PowerShell
```

Then register it in the `providers` map inside `src/index.ts`:

```ts
'openai': new OpenAIAdapter()
```

The router, breaker, health checks, and metrics will pick it up automatically.

## Design notes

- The breaker state and metrics live in memory, which is fine for a single process but not for multiple app instances behind a shared load balancer.
- Fast-fail is preferred over retrying an already failing provider; it avoids paying the latency cost of a dead connection.
- Timeouts are enforced by the router itself, so an adapter that ignores `AbortSignal` still cannot stall the fallback chain. Aborting is sent as well, so well-behaved adapters can stop their work early.
- This project does not queue requests or do retry-with-backoff. A `502` is a deliberate signal that every provider failed at that moment.
- The project is intentionally dependency-free at runtime. It uses the Node standard library and keeps the code easy to read.

## License

MIT
