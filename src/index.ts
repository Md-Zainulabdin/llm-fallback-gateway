import { HOST, PORT } from './config';
import { FallbackRouter } from './core/router';
import { createGatewayServer } from './http/server';
import { MetricsCollector } from './observability/metrics';
import { MockAdapter } from './providers/mockAdapter';
import { ProviderAdapter } from './types';

/**
 * Composition root: wires providers into the router, attaches metrics,
 * and starts the HTTP server.
 *
 * To integrate a real LLM API, implement ProviderAdapter (see src/types.ts)
 * and register it here.
 */
const providers: Record<string, ProviderAdapter> = {
  'mock-failing': new MockAdapter('mock-failing', 'mock-claude-3-5', 50, true),
  'mock-hanging': new MockAdapter('mock-hanging', 'mock-gpt-4o', 3000),
  'mock-backup': new MockAdapter('mock-backup', 'mock-gemini-1-5', 80),
};

const router = new FallbackRouter(providers);
const metrics = new MetricsCollector();
const server = createGatewayServer(router, metrics);

server.listen(PORT, HOST, () => {
  console.log(`LLM routing gateway listening on http://${HOST}:${PORT}`);
});

const shutdown = () => server.close(() => process.exit(0));

// Docker/Kubernetes send SIGTERM; Ctrl+C sends SIGINT.
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
