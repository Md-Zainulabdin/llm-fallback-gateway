import { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_TIMEOUT_MS } from '../config';
import { FallbackRouter } from '../core/router';
import { MetricsCollector } from '../observability/metrics';
import { readJsonBody, validateChatRequest } from './request';
import { errorMessage, HttpError, httpErrorName, sendJson } from './response';

/**
 * Builds the POST /generate handler.
 *
 * Flow: read body -> validate -> route with fallback -> record metrics -> respond.
 */
export function createChatHandler(router: FallbackRouter, metrics: MetricsCollector) {
  return async function handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let requestBody: unknown;

    try {
      requestBody = await readJsonBody(req);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 400;
      if (statusCode === 413) {
        // The oversized body will never be read, so the connection cannot be reused.
        res.setHeader('Connection', 'close');
      }
      return sendJson(res, statusCode, { error: httpErrorName(statusCode), message: errorMessage(error) });
    }

    const validation = validateChatRequest(requestBody);
    if (!validation.ok) {
      return sendJson(res, 400, { error: 'Bad Request', message: validation.message });
    }

    const startTime = Date.now();

    try {
      const { response, attemptLogs, fastFailed } = await router.routeWithFallback(
        validation.request,
        DEFAULT_TIMEOUT_MS
      );
      const totalLatencyMs = Date.now() - startTime;

      metrics.recordRequest(totalLatencyMs, true, fastFailed);
      sendJson(res, 200, { ...response, meta: { attemptLogs, totalLatencyMs } });
    } catch (error) {
      const totalLatencyMs = Date.now() - startTime;

      metrics.recordRequest(totalLatencyMs, false);
      sendJson(res, 502, {
        error: 'Bad Gateway - Fallback Chain Exhausted',
        message: errorMessage(error),
      });
    }
  };
}
