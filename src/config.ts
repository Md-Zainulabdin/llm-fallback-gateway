/** Application-level constants. Environment variables can override these. */

/** Interface the gateway binds to. Loopback by default; set HOST=0.0.0.0 to expose. */
export const HOST = process.env.HOST || '127.0.0.1';

/** TCP port the gateway listens on. */
export const PORT = Number(process.env.PORT) || 3000;

/** Time budget for a single provider attempt when the request does not specify one. */
export const DEFAULT_TIMEOUT_MS = 1000;

/** Maximum accepted request body size (bytes). Larger bodies are rejected with 413. */
export const MAX_BODY_BYTES = 1_000_000;

/** Maximum requests per client per minute. */
export const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 300;

/**
 * Optional gateway API key. When set, every request must include it in an
 * `x-api-key` header. When unset, the gateway relies on the loopback bind.
 */
export const API_KEY = process.env.GATEWAY_API_KEY;
