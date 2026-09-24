/**
 * Webhook Evento envelope + Stripe-style signature verification, matching
 * the dispatch service's own `signPayload`/`buildHeaders`
 * (`src/services/webhook-dispatch.service.ts` in vitrina-app; cross-ticket
 * contract C3). The signature is an HMAC-SHA256 over `${timestamp}.${body}`
 * with the subscription's `whsec_...` secret, carried as
 * `X-Webhook-Signature: t=<unix_seconds>,v1=<hex>`.
 *
 * `tests/api-sdk-webhook-signature.test.ts` (vitrina-app repo root) verifies
 * this against the REAL `signPayload` the dispatch service calls in
 * production — not a hand-written fixture.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** `resource` on the envelope — what changed, and where to read it. */
export interface WebhookEventResource {
  type: string;
  id: string | null;
  /** Absolute `GET` URL for this resource, or `null` when none is available
   *  (e.g. the event has no single owning record). Feeds `event.fetch()`. */
  url: string | null;
}

/** Who did it — see `Author` in vitrina-app's `src/types/author.ts` (C3). */
export interface WebhookEventAuthor {
  kind: 'member' | 'api_key' | 'ai_agent' | 'system' | 'contact';
  id: string | null;
  name: string | null;
  via?: { kind: 'connected_app' | 'personal_token'; name: string };
}

/** Why `data` is absent — every reason a subscription's owner can be denied
 *  the resource body. `missing_scope:<scope>` is a family, not one literal. */
export type DataOmittedReason =
  | 'not_requested'
  | 'sensitive'
  | 'owner_unavailable'
  | 'restricted_visibility'
  | `missing_scope:${string}`;

/** One Evento, exactly as it arrives on the wire. Exactly one of `data` /
 *  `data_omitted` is ever present. */
export interface WebhookEventEnvelope<TData = Record<string, unknown>> {
  id: string;
  type: string;
  version: number;
  /** `false` for an event from a sandbox (test-mode) workspace, `true`
   *  otherwise; mirrored on the delivery's `Vitrina-Livemode` header.
   *  Optional here only so an envelope captured before vitrina-app#2693
   *  still satisfies this type — every envelope on the wire carries it. */
  livemode?: boolean;
  created_at: string;
  tenant_id: string;
  resource: WebhookEventResource;
  changes?: Record<string, { from: unknown; to: unknown }>;
  author: WebhookEventAuthor;
  data?: TData;
  data_omitted?: DataOmittedReason;
}

export interface VerifySignatureOptions {
  /** How far `X-Webhook-Timestamp` may drift from now before a signature
   *  that otherwise matches is rejected as stale (replay protection).
   *  Default 300 (5 minutes), matching the docs' own verifier. */
  toleranceSeconds?: number;
  /** Override "now", in Unix seconds — for tests. */
  nowUnix?: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'malformed_header' | 'bad_signature' | 'stale' };

function parseSignatureHeader(
  header: string,
): { timestamp: number; v1: string } | null {
  const parts: Record<string, string> = {};
  for (const pair of header.split(',')) {
    const at = pair.indexOf('=');
    if (at === -1) continue;
    parts[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return null;
  return { timestamp, v1: parts.v1 };
}

/**
 * Verifies an `X-Webhook-Signature` header against the raw delivery body.
 * Never throws — returns `{ ok: false, reason }` so a caller can log why a
 * delivery was rejected. `rawBody` must be the exact bytes the delivery
 * sent, before any JSON re-serialization (re-stringifying a parsed body
 * produces different bytes and the signature will never match).
 */
export function verifyWebhookSignature(
  params: {
    secret: string;
    signatureHeader: string;
    rawBody: string | Buffer;
  } & VerifySignatureOptions,
): VerifyResult {
  const parsed = parseSignatureHeader(params.signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const body =
    typeof params.rawBody === 'string'
      ? params.rawBody
      : params.rawBody.toString('utf8');
  const expected = createHmac('sha256', params.secret)
    .update(`${parsed.timestamp}.${body}`)
    .digest('hex');

  const given = Buffer.from(parsed.v1, 'utf8');
  const mine = Buffer.from(expected, 'utf8');
  const signatureMatches =
    given.length === mine.length && timingSafeEqual(given, mine);
  if (!signatureMatches) return { ok: false, reason: 'bad_signature' };

  const tolerance = params.toleranceSeconds ?? 300;
  const now = params.nowUnix ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'stale' };
  }
  return { ok: true };
}

export class WebhookSignatureError extends Error {
  readonly reason: Exclude<VerifyResult, { ok: true }>['reason'];

  constructor(reason: Exclude<VerifyResult, { ok: true }>['reason']) {
    super(`Webhook signature verification failed: ${reason}`);
    this.name = 'WebhookSignatureError';
    this.reason = reason;
  }
}

/**
 * Verifies + parses an Evento delivery in one call (Stripe's
 * `constructEvent` naming, same idea): throws `WebhookSignatureError`
 * instead of returning a result a caller might forget to check before
 * trusting `rawBody`.
 */
export function constructEventEnvelope<TData = Record<string, unknown>>(
  params: {
    secret: string;
    signatureHeader: string;
    rawBody: string | Buffer;
  } & VerifySignatureOptions,
): WebhookEventEnvelope<TData> {
  const result = verifyWebhookSignature(params);
  if (!result.ok) throw new WebhookSignatureError(result.reason);
  const body =
    typeof params.rawBody === 'string'
      ? params.rawBody
      : params.rawBody.toString('utf8');
  return JSON.parse(body) as WebhookEventEnvelope<TData>;
}
