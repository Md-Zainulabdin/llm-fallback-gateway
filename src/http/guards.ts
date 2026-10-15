import { IncomingMessage, ServerResponse } from 'node:http';
import { API_KEY, RATE_LIMIT_PER_MINUTE } from '../config';
import { sendJson } from './response';

const WINDOW_MS = 60_000;

/** Fixed-window request counter, keyed by client. */
export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = WINDOW_MS
  ) {}

  /** Records a request; reports whether it is allowed and when to retry. */
  check(client: string, now: number = Date.now()): { ok: boolean; retryAfterSec: number } {
    this.dropExpired(now);

    let bucket = this.buckets.get(client);
    if (!bucket) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(client, bucket);
    }

    if (bucket.count >= this.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return { ok: false, retryAfterSec };
    }

    bucket.count++;
    return { ok: true, retryAfterSec: 0 };
  }

  private dropExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

const limiter = new RateLimiter(RATE_LIMIT_PER_MINUTE);

/**
 * Applies auth and rate limiting to an incoming request.
 * Returns true when the request may proceed; otherwise sends the error
 * response (401/429) and returns false.
 */
export function guardRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (!authorize(req, res)) return false;
  if (!rateLimit(req, res)) return false;
  return true;
}

function authorize(req: IncomingMessage, res: ServerResponse): boolean {
  if (!API_KEY) return true; // No key configured: the loopback bind is the guard.

  const provided = req.headers['x-api-key'];
  if (provided === API_KEY) return true;

  sendJson(res, 401, {
    error: 'Unauthorized',
    message: 'Missing or invalid x-api-key header',
  });
  return false;
}

function rateLimit(req: IncomingMessage, res: ServerResponse): boolean {
  const client = req.socket.remoteAddress ?? 'unknown';
  const result = limiter.check(client);

  if (result.ok) return true;

  res.setHeader('Retry-After', String(result.retryAfterSec));
  sendJson(res, 429, {
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Retry in ${result.retryAfterSec}s`,
  });
  return false;
}
