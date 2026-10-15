const TARGET_URL = 'http://localhost:3000/generate';
const CONCURRENT_REQUESTS = 50;

async function runStressTest(): Promise<void> {
  console.log(`Starting stress test: ${CONCURRENT_REQUESTS} concurrent requests...`);
  const startTime = Date.now();

  const requests = Array.from({ length: CONCURRENT_REQUESTS }, async (_, index) => {
    try {
      const response = await fetch(TARGET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Stress request #${index}`,
          providerPriority: ['mock-failing', 'mock-backup'],
        }),
      });
      return response.status;
    } catch {
      return 0; // Connection failed (server not running)
    }
  });

  const statusCodes = await Promise.all(requests);
  const duration = Date.now() - startTime;
  const successes = statusCodes.filter(status => status === 200).length;

  console.log(`Completed ${CONCURRENT_REQUESTS} requests in ${duration}ms`);
  console.log(`Status codes: 200 OK x ${successes}, other x ${statusCodes.length - successes}`);

  const metricsResponse = await fetch('http://localhost:3000/metrics');
  const metrics = await metricsResponse.json();

  console.log('Server metrics:');
  console.dir(metrics, { depth: null });
}

runStressTest().catch(error => {
  console.error('Stress test failed:', error);
  process.exit(1);
});
