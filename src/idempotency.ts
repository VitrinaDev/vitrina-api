/**
 * `Idempotency-Key` — replay-safe retries on the 39 published write
 * operations that accept it (ADR 0106 §2.3/#2400). Resending the SAME key
 * with the SAME body returns the original response (`X-Idempotent-Replay:
 * 1`) instead of creating a second copy; the same key with a DIFFERENT body
 * answers `409 IDEMPOTENCY_KEY_CONFLICT` (`VitrinaApiError#isIdempotencyConflict`).
 *
 * The generated types already carry `Idempotency-Key` as a typed header
 * parameter per operation — `idempotencyKey()` just builds a well-formed
 * value to put there:
 *
 *     await api.POST('/pipelines', {
 *       params: { header: idempotencyKey(`provision-${userId}-2026-04-24`) },
 *       body: { ... },
 *     });
 */
import { randomUUID } from 'node:crypto';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

export interface IdempotencyKeyHeader {
  'Idempotency-Key': string;
}

/**
 * Validates `key` against the server's own constraint (`minLength: 8,
 * maxLength: 200, pattern: ^[A-Za-z0-9_-]+$` on every operation that accepts
 * it) and returns it as a header object to spread into `params.header`.
 * Throws `RangeError` on a malformed key — better to fail before the
 * request leaves than to get back a generic `VALIDATION_ERROR`.
 */
export function idempotencyKey(key: string): IdempotencyKeyHeader {
  if (!KEY_PATTERN.test(key)) {
    throw new RangeError(
      `Idempotency-Key must be 8-200 characters of [A-Za-z0-9_-], got: ${JSON.stringify(key)}`,
    );
  }
  return { 'Idempotency-Key': key };
}

/**
 * A fresh, valid `Idempotency-Key`. Mint ONE per logical operation and reuse
 * it across THAT operation's retries — generating a new key per attempt
 * defeats the point (each attempt would look like a different write). `
 * prefix` is optional and purely for your own log-grepping; it plays no
 * role on the server.
 */
export function generateIdempotencyKey(prefix?: string): string {
  const id = randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}-${id}` : id;
}
