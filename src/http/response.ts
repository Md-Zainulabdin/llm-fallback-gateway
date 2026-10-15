import { ServerResponse } from 'node:http';

/** Error that carries the HTTP status code it should be rendered with. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

/** Writes a JSON payload with the given status code and closes the response. */
export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Sends a 405 response advertising which method the route actually accepts. */
export function methodNotAllowed(res: ServerResponse, actualMethod: string, allowedMethod: string): void {
  res.setHeader('Allow', allowedMethod);
  sendJson(res, 405, {
    error: 'Method Not Allowed',
    message: `${actualMethod} is not supported here; use ${allowedMethod}`,
  });
}

/** Human-readable name for the 4xx errors raised while reading a request body. */
export function httpErrorName(statusCode: number): string {
  return statusCode === 413 ? 'Payload Too Large' : 'Bad Request';
}

/** Extracts a readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
