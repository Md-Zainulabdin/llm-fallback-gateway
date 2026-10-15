import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from './circuitBreaker';

const FAST_CONFIG = { failureThreshold: 3, cooldownMs: 50 };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('starts CLOSED and allows execution', () => {
  const breaker = new CircuitBreaker('test-provider', FAST_CONFIG);

  assert.equal(breaker.getState(), 'CLOSED');
  assert.equal(breaker.canExecute(), true);
});

test('stays CLOSED until the failure threshold is reached', () => {
  const breaker = new CircuitBreaker('test-provider', FAST_CONFIG);

  breaker.recordFailure();
  breaker.recordFailure();

  assert.equal(breaker.getState(), 'CLOSED');

  breaker.recordFailure();

  assert.equal(breaker.getState(), 'OPEN');
  assert.equal(breaker.canExecute(), false);
});

test('a success resets the consecutive failure counter', () => {
  const breaker = new CircuitBreaker('test-provider', FAST_CONFIG);

  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordSuccess();
  breaker.recordFailure();
  breaker.recordFailure();

  assert.equal(breaker.getState(), 'CLOSED');
});

test('moves from OPEN to HALF-OPEN after the cooldown expires', async () => {
  const breaker = new CircuitBreaker('test-provider', FAST_CONFIG);

  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), 'OPEN');

  await sleep(FAST_CONFIG.cooldownMs + 10);

  assert.equal(breaker.getState(), 'HALF-OPEN');
  assert.equal(breaker.canExecute(), true);
});

test('a successful probe in HALF-OPEN closes the breaker', async () => {
  const breaker = new CircuitBreaker('test-provider', FAST_CONFIG);

  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  await sleep(FAST_CONFIG.cooldownMs + 10);
  assert.equal(breaker.getState(), 'HALF-OPEN');

  breaker.recordSuccess();

  assert.equal(breaker.getState(), 'CLOSED');
});

test('a failed probe in HALF-OPEN re-opens the breaker immediately', async () => {
  const breaker = new CircuitBreaker('test-provider', FAST_CONFIG);

  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  await sleep(FAST_CONFIG.cooldownMs + 10);
  assert.equal(breaker.getState(), 'HALF-OPEN');

  breaker.recordFailure();

  assert.equal(breaker.getState(), 'OPEN');
});

test('reports stats with state, failure count, and last change time', () => {
  const breaker = new CircuitBreaker('test-provider', FAST_CONFIG);
  breaker.recordFailure();

  const stats = breaker.getStats();

  assert.equal(stats.state, 'CLOSED');
  assert.equal(stats.consecutiveFailures, 1);
  assert.ok(!Number.isNaN(Date.parse(stats.lastStateChange)));
});

test('allows only one probe while HALF-OPEN under concurrent traffic', async () => {
  const breaker = new CircuitBreaker('test-provider', { failureThreshold: 1, cooldownMs: 30 });

  breaker.recordFailure();
  await sleep(40);
  assert.equal(breaker.getState(), 'HALF-OPEN');

  // Ten callers race for the probe slot at staggered times; only one may win.
  const results = await Promise.all(
    Array.from({ length: 10 }, async (_, index) => {
      await sleep(index * 2);
      return breaker.canExecute();
    })
  );

  assert.equal(results.filter(Boolean).length, 1);
});

test('releases the probe slot once the probe settles', async () => {
  const breaker = new CircuitBreaker('test-provider', { failureThreshold: 3, cooldownMs: 30 });

  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  await sleep(40);
  assert.equal(breaker.getState(), 'HALF-OPEN');

  // First caller claims the probe; everyone else fast-fails meanwhile.
  assert.equal(breaker.canExecute(), true);
  assert.equal(breaker.canExecute(), false);

  // Probe fails -> OPEN, slot released on the next recovery cycle.
  breaker.recordFailure();
  assert.equal(breaker.canExecute(), false);
  await sleep(40);
  assert.equal(breaker.canExecute(), true);
});

test('a successful probe frees the slot and admits normal traffic again', async () => {
  const breaker = new CircuitBreaker('test-provider', { failureThreshold: 1, cooldownMs: 30 });

  breaker.recordFailure();
  await sleep(40);
  assert.equal(breaker.canExecute(), true); // claims the probe

  breaker.recordSuccess();
  assert.equal(breaker.getState(), 'CLOSED');
  assert.equal(breaker.canExecute(), true);
  assert.equal(breaker.canExecute(), true); // CLOSED admits everyone
});
