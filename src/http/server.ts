import { createServer, Server } from 'node:http';
import { FallbackRouter } from '../core/router';
import { MetricsCollector } from '../observability/metrics';
import { createChatHandler } from './chatHandler';
import { guardRequest } from './guards';
import { methodNotAllowed, sendJson } from './response';

/**
 * Creates the gateway HTTP server with its route table.
 *
 *  GET  /health                 -> circuit breaker states for every provider
 *  GET  /metrics                -> latency percentiles and error counters
 *  POST /generate               -> routed completion with fallback
 *
 * The server is returned unstarted; the caller owns listen/close.
 */
export function createGatewayServer(router: FallbackRouter, metrics: MetricsCollector): Server {
  const handleChatCompletion = createChatHandler(router, metrics);

  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0];

    // Auth (optional API key) and rate limiting run before any route matches.
    if (!guardRequest(req, res)) return;

    switch (path) {
      case '/health':
        if (method !== 'GET') return methodNotAllowed(res, method, 'GET');
        return sendJson(res, 200, router.getSystemHealth());

      case '/metrics':
        if (method !== 'GET') return methodNotAllowed(res, method, 'GET');
        return sendJson(res, 200, metrics.getSummary());

      case '/generate':
        if (method !== 'POST') return methodNotAllowed(res, method, 'POST');
        return handleChatCompletion(req, res);

      default:
        return sendJson(res, 404, { error: 'Not Found', message: `No route for ${method} ${path}` });
    }
  });
}
