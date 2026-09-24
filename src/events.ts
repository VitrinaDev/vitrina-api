/**
 * `event.fetch()` — read an Evento's resource in one call, using the same
 * credentials the client was created with. `resource.url` is the absolute
 * `GET` URL the server already computed (`apiPublicUrl()` in
 * `webhook-dispatch.service.ts`), so this is a plain authenticated fetch of
 * that URL — no per-resource-type routing table to keep in sync.
 */
import { toApiError } from './errors';
import {
  constructEventEnvelope,
  verifyWebhookSignature,
  type VerifySignatureOptions,
  type WebhookEventEnvelope,
} from './webhooks';

export class EventResourceUnavailableError extends Error {
  readonly event: WebhookEventEnvelope;

  constructor(event: WebhookEventEnvelope) {
    super(
      event.data_omitted
        ? `Event ${event.id} (${event.type}) carries no resource URL — data_omitted: ${event.data_omitted}`
        : `Event ${event.id} (${event.type}) carries no resource URL`,
    );
    this.name = 'EventResourceUnavailableError';
    this.event = event;
  }
}

/** A parsed Evento, plus a `fetch()` bound to the client it came from. */
export type VitrinaEvent<TData = Record<string, unknown>> =
  WebhookEventEnvelope<TData> & {
    /**
     * `GET`s `resource.url` with this client's credentials and returns its
     * `data`. Throws `EventResourceUnavailableError` when the envelope has no
     * URL (an event with no single owning resource, or one whose `data` you
     * already have inline). Pass a type argument to get the resource typed:
     * `await event.fetch<Contact>()`.
     */
    fetch<TResource = TData>(): Promise<TResource>;
  };

export interface EventFetcherDeps {
  headers: HeadersInit;
  fetch: typeof fetch;
}

/** Builds the `events` namespace `createClient()` attaches to every client:
 *  signature verification bound to nothing (pure functions), and
 *  `constructEvent` bound to this client's own auth so the returned event's
 *  `.fetch()` needs no arguments. */
export function createEventsNamespace(deps: EventFetcherDeps) {
  // `WebhookEventEnvelope<any>`: this helper only ever reads `resource` /
  // `data_omitted` / `id` / `type`, never `.data`, so it is deliberately
  // NOT generic over TData — a `WebhookEventEnvelope<TData>` for any TData
  // must be assignable here.
  async function fetchResource<TResource>(
    event: WebhookEventEnvelope<any>,
  ): Promise<TResource> {
    if (!event.resource.url) throw new EventResourceUnavailableError(event);
    const res = await deps.fetch(event.resource.url, { headers: deps.headers });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      throw toApiError(res.status, json, {
        requestUrl: event.resource.url,
        requestMethod: 'GET',
      });
    }
    return (json as { data: TResource })?.data;
  }

  return {
    /** Verifies an `X-Webhook-Signature` header. Never throws. */
    verifySignature: (
      params: {
        secret: string;
        signatureHeader: string;
        rawBody: string | Buffer;
      } & VerifySignatureOptions,
    ) => verifyWebhookSignature(params),

    /**
     * Verifies + parses a webhook delivery and returns it with a bound
     * `.fetch()`. Throws `WebhookSignatureError` on a bad/stale signature.
     *
     *     const event = client.events.constructEvent({
     *       secret: subscriptionSecret,
     *       signatureHeader: req.headers['x-webhook-signature'],
     *       rawBody: req.rawBody,
     *     });
     *     if (event.type === 'contact.created') {
     *       const contact = await event.fetch<Contact>();
     *     }
     */
    constructEvent<TData = Record<string, unknown>>(
      params: {
        secret: string;
        signatureHeader: string;
        rawBody: string | Buffer;
      } & VerifySignatureOptions,
    ): VitrinaEvent<TData> {
      const envelope = constructEventEnvelope<TData>(params);
      return Object.assign(envelope, {
        fetch: <TResource = TData>() => fetchResource<TResource>(envelope),
      });
    },
  };
}
