/**
 * `createClient()` — a typed `openapi-fetch` client over the API pública
 * (`paths` generated from the committed `openapi.public.json`), plus the
 * `events` namespace (webhook signature verification + `event.fetch()`).
 *
 * Auth: pass an `sk_*` API key (workspace credential or personal token —
 * both are Bearer) or a raw bearer token you manage yourself. Exactly one of
 * `apiKey` / `bearer`.
 */
import createOpenApiClient, { type Client } from 'openapi-fetch';

import { createEventsNamespace, type VitrinaEvent } from './events';
import type { paths } from './generated/api-types';
import type { VerifySignatureOptions, VerifyResult } from './webhooks';

export interface CreateClientOptions {
  /** Absolute base URL, e.g. `https://api.vitrinadev.com/api/v1`. No trailing slash. */
  baseUrl: string;
  /** An `sk_*` API key (workspace key or personal token). Mutually exclusive with `bearer`. */
  apiKey?: string;
  /** A raw bearer token, for a caller that manages tokens itself (e.g. a Supabase session JWT). */
  bearer?: string;
  /** Extra headers merged onto every request (e.g. a custom `User-Agent`). */
  headers?: Record<string, string>;
  /** Override `fetch` — Node <18, undici, msw, a test double. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export interface VitrinaEventsNamespace {
  /** Verifies an `X-Webhook-Signature` header. Never throws. */
  verifySignature(
    params: {
      secret: string;
      signatureHeader: string;
      rawBody: string | Buffer;
    } & VerifySignatureOptions,
  ): VerifyResult;
  /** Verifies + parses a webhook delivery; the returned event carries a
   *  `.fetch()` bound to this client. Throws `WebhookSignatureError`. */
  constructEvent<TData = Record<string, unknown>>(
    params: {
      secret: string;
      signatureHeader: string;
      rawBody: string | Buffer;
    } & VerifySignatureOptions,
  ): VitrinaEvent<TData>;
}

/** The typed REST client (`GET`/`POST`/.../`use`/`eject`, from `openapi-fetch`)
 *  plus the `events` namespace. */
export type VitrinaClient = Client<paths> & { events: VitrinaEventsNamespace };

export function createClient(opts: CreateClientOptions): VitrinaClient {
  if (opts.apiKey && opts.bearer) {
    throw new RangeError(
      'createClient(): pass at most one of `apiKey` / `bearer`, not both',
    );
  }
  const credential = opts.apiKey ?? opts.bearer;
  const headers: Record<string, string> = {
    ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
    ...opts.headers,
  };
  const fetchImpl = opts.fetch ?? fetch;

  const base = createOpenApiClient<paths>({
    baseUrl: opts.baseUrl,
    headers,
    fetch: fetchImpl,
  });

  const events = createEventsNamespace({ headers, fetch: fetchImpl });

  return Object.assign(base, { events });
}
