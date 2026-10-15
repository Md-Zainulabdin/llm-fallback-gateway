import { IncomingMessage } from 'node:http';
import { MAX_BODY_BYTES } from '../config';
import { UnifiedRequest } from '../types';
import { HttpError } from './response';

export type ValidationResult = { ok: true; request: UnifiedRequest } | { ok: false; message: string };

/** Reads and parses the full JSON request body, enforcing the size limit. */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        // Stop reading the oversized body but keep the socket alive,
        // so the handler can still send a 413 response.
        req.pause();
        reject(new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();

      if (raw === '') {
        reject(new HttpError(400, 'Request body is empty'));
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON'));
      }
    });

    req.on('error', reject);
  });
}

/** Checks that an untrusted body matches the UnifiedRequest contract. */
export function validateChatRequest(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, message: 'Body must be a JSON object' };
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
    return { ok: false, message: '"prompt" is required and must be a non-empty string' };
  }

  const optionalFieldErrors = [
    checkOptional('systemPrompt', body.systemPrompt, v => typeof v === 'string'),
    checkOptional('maxTokens', body.maxTokens, v => isPositiveInteger(v)),
    checkOptional('temperature', body.temperature, v => typeof v === 'number' && v >= 0 && v <= 2),
    checkOptional('timeoutMs', body.timeoutMs, v => isPositiveInteger(v)),
    checkOptional('providerPriority', body.providerPriority, v => isStringArray(v)),
  ].filter((error): error is string => error !== undefined);

  if (optionalFieldErrors.length > 0) {
    return { ok: false, message: optionalFieldErrors.join('; ') };
  }

  return { ok: true, request: body as unknown as UnifiedRequest };
}

function checkOptional(
  field: string,
  value: unknown,
  isValid: (value: unknown) => boolean
): string | undefined {
  if (value === undefined) return undefined;
  return isValid(value) ? undefined : `"${field}" has an invalid value`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
