# `@vitrina/api`

The TypeScript SDK for the [Vitrina](https://vitrinadev.com) public API. Every route, every error code
and every webhook event is typed from the same OpenAPI contract the backend serves, so the editor
knows the shape before you run anything.

```bash
npm install @vitrina/api
```

Node 18 or newer. The version matches the platform release it describes: `@vitrina/api@11.1.2`
documents API 11.1.2.

Full guide: **https://docs.vitrinadev.com/docs/sdk**

## The client

```ts
import { createClient } from '@vitrina/api';

const client = createClient({
  baseUrl: 'https://api.vitrinadev.com/api/v1',
  apiKey: process.env.VITRINA_KEY,
});

const { data, error } = await client.GET('/locations');
if (error) throw error;
console.log(data.data[0].name);
```

`apiKey` takes an `sk_` API key or a personal token. If you manage your own tokens — a Supabase
session, say — pass `bearer` instead. The client accepts at most one of the two.

Mint a key in the app under **Configuración › Desarrolladores › API keys**, or over the API with a key
that already holds `api_keys:write`.

## Errors you can branch on

`unwrap()` collapses the `{ data, error }` pair and throws a typed error instead:

```ts
import { unwrap, VitrinaApiError } from '@vitrina/api';

try {
  const locations = unwrap(await client.GET('/locations'));
} catch (err) {
  if (err instanceof VitrinaApiError) {
    err.status;    // 404
    err.code;      // 'NOT_FOUND', typed against the catalogue
    err.requestId; // the id to quote when you ask us about the call
  }
}
```

`isNotFound`, `isUnauthorized`, `isForbidden`, `isRateLimited` and `isIdempotencyConflict` cover the
common branches. Branch on `err.code`, never on `err.message`.

> `err.code` is typed `ErrorCode | (string & {})`. Autocomplete shows the codes that existed when the
> package was generated, and a server release can publish a new one before you upgrade — so a `switch`
> over it still needs a `default`.

`OutboundVerdictError` is the one worth knowing about beyond the usual: a send that the outbound
policy refuses carries the verdict that refused it.

## Retrying without duplicating

```ts
import { idempotencyKey, generateIdempotencyKey } from '@vitrina/api';

await client.POST('/pipelines', {
  params: { header: idempotencyKey(`crear-pipeline-${userId}`) },
  body: { name: 'Postventa' },
});
```

The same key with the same body replays the original response instead of creating a second copy. The
same key with a *different* body answers `409 IDEMPOTENCY_KEY_CONFLICT`, which `isIdempotencyConflict`
recognises. Use a natural key when you have one; `generateIdempotencyKey()` when you don't.

## Pagination — check the route first

The API paginates three ways, and the SDK's helper covers one of them on purpose:

| Shape | Operations | Helper |
|---|---|---|
| `cursor` / `limit` | 2 — `GET /appointments`, `GET /conversations/{id}/messages` | `paginate()`, `paginateAll()` |
| `offset` / `limit` | 15 — `/stock`, `/vehicles`, `/contacts/search`, … | your own loop |
| `page` / `page_size` | the rest, `/leads` among them | your own loop |

```ts
import { paginate } from '@vitrina/api';

for await (const appointment of paginate((cursor) =>
  client.GET('/appointments', { params: { query: { cursor, limit: 100 } } }),
)) {
  console.log(appointment.id);
}
```

Passing `cursor` to a route that paginates by `offset` does not quietly return the first page — it does
not compile. That is what generating this package from the contract buys you.

## Webhooks

`constructEvent()` verifies the HMAC, checks the timestamp window, and hands back a typed envelope:

```ts
app.post('/vitrina', express.raw({ type: 'application/json' }), (req, res) => {
  const event = client.events.constructEvent({
    secret: process.env.VITRINA_WEBHOOK_SECRET!,
    signatureHeader: req.header('X-Webhook-Signature')!,
    rawBody: req.body,
  });

  if (event.type === 'contact.created') console.log(event.data?.name);
  res.json({ received: true });
});
```

> **The raw body, not a reparsed one.** The signature is over the bytes that arrived, and
> `JSON.parse` followed by `JSON.stringify` produces a different string. Mount the receiver with
> `express.raw({ type: 'application/json' })` and pass that buffer straight to `rawBody`. A `req.body`
> that `express.json()` already reparsed will fail every signature.

It throws `WebhookSignatureError` rather than returning a result you can forget to check. If you want
`{ ok, reason }` without the exception, use `client.events.verifySignature()`.

When a subscription did not ask for `include_data`, or the event arrives as a notice because its owner
lacked the scope, the envelope carries `resource.url` and nothing in `data`. `event.fetch()` resolves
it with the same client's credentials, and throws `EventResourceUnavailableError` when there is no
single owning resource to fetch.

## Exports

`createClient` · `unwrap` · `VitrinaApiError` · `OutboundVerdictError` · `WebhookSignatureError` ·
`EventResourceUnavailableError` · `paginate` · `paginateAll` · `idempotencyKey` ·
`generateIdempotencyKey` · `verifyWebhookSignature` · `constructEventEnvelope` · and the generated
`paths`, `components`, `operations` types.

## Regenerating

The types come from the committed `openapi.public.json` at the repo root, never from a live server:

```bash
pnpm run generate   # types + the error catalogue
pnpm run build
pnpm run test
```

## Licence

MIT.
