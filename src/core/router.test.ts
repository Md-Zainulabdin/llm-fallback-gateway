import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FallbackRouter } from './router';
import { MockAdapter } from '../providers/mockAdapter';

const failing = () => new MockAdapter('mock-failing', 'mock-claude-3-5', 10, true);
const healthy = () => new MockAdapter('mock-backup', 'mock-gemini-1-5', 10);
const hanging = () => new MockAdapter('mock-hanging', 'mock-gpt-4o', 5000);

test('returns the response from the first healthy provider', async () => {
  const router = new FallbackRouter({ 'mock-backup': healthy() });

  const { response, fastFailed, attemptLogs } = await router.routeWithFallback({
    prompt: 'hello',
  });

  assert.equal(response.provider, 'mock-backup');
  assert.equal(fastFailed, false);
  assert.ok(attemptLogs.some(log => log.startsWith('SUCCESS')));
});

test('falls back to the next provider when one fails', async () => {
  const router = new FallbackRouter({
    'mock-failing': failing(),
    'mock-backup': healthy(),
  });

  const { response, attemptLogs } = await router.routeWithFallback({
    prompt: 'hello',
    providerPriority: ['mock-failing', 'mock-backup'],
  });

  assert.equal(response.provider, 'mock-backup');
  assert.ok(attemptLogs.some(log => log.startsWith('FAILED   [mock-failing]')));
  assert.ok(attemptLogs.some(log => log.startsWith('SUCCESS  [mock-backup]')));
});

test('fast-fails a provider whose circuit breaker is open', async () => {
  const router = new FallbackRouter(
    { 'mock-failing': failing(), 'mock-backup': healthy() },
    { failureThreshold: 1, cooldownMs: 60_000 }
  );

  const priority = ['mock-failing', 'mock-backup'];

  // First request trips the breaker after the initial failure.
  await router.routeWithFallback({ prompt: 'one', providerPriority: priority });

  // Second request must skip the broken provider without attempting it.
  const { fastFailed, attemptLogs } = await router.routeWithFallback({
    prompt: 'two',
    providerPriority: priority,
  });

  assert.equal(fastFailed, true);
  assert.ok(attemptLogs.some(log => log.startsWith('FAST-FAIL [mock-failing]')));
  assert.ok(!attemptLogs.some(log => log.startsWith('ATTEMPT  [mock-failing]')));
});

test('skips unregistered providers in the priority chain', async () => {
  const router = new FallbackRouter({ 'mock-backup': healthy() });

  const { response, attemptLogs } = await router.routeWithFallback({
    prompt: 'hello',
    providerPriority: ['does-not-exist', 'mock-backup'],
  });

  assert.equal(response.provider, 'mock-backup');
  assert.ok(attemptLogs.some(log => log.startsWith('SKIPPED  [does-not-exist]')));
});

test('aborts a slow provider and falls back on timeout', async () => {
  const router = new FallbackRouter({
    'mock-hanging': hanging(),
    'mock-backup': healthy(),
  });

  const { response, attemptLogs } = await router.routeWithFallback({
    prompt: 'hello',
    providerPriority: ['mock-hanging', 'mock-backup'],
    timeoutMs: 50,
  });

  assert.equal(response.provider, 'mock-backup');
  assert.ok(attemptLogs.some(log => log.includes('timed out after 50ms')));
});

test('throws with full attempt logs when every provider fails', async () => {
  const router = new FallbackRouter({ 'mock-failing': failing() });

  await assert.rejects(
    () => router.routeWithFallback({ prompt: 'hello' }),
    (error: Error) => {
      assert.ok(error.message.includes('All providers in the fallback chain failed'));
      assert.ok(error.message.includes('[mock-failing]'));
      return true;
    }
  );
});

test('exposes circuit breaker health for every registered provider', async () => {
  const router = new FallbackRouter({ 'mock-backup': healthy() });

  const health = router.getSystemHealth();

  assert.deepEqual(Object.keys(health), ['mock-backup']);
  assert.equal(health['mock-backup'].state, 'CLOSED');
});
