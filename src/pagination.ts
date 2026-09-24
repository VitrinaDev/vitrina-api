/**
 * Cursor pagination — walks a list endpoint page by page, yielding one item
 * at a time (`for await`). Vitrina's list envelopes carry the cursor as
 * `meta.pagination.nextCursor` (the shape every v1 list route in production
 * answers with — `ok(res, rows, { pagination: { nextCursor, limit } })`,
 * `src/routes/api/v1/*.ts`) with a `meta.nextCursor` fallback for the flat
 * `PaginationMeta` OpenAPI shape (`src/api/openapi-responses.ts`) some
 * generated docs describe; this helper reads either. The opaque cursor
 * itself is a base64url-encoded `{ ts, id }` pair (`src/api/pagination.ts`)
 * — never decode it, just pass it back as the next page's `cursor` query
 * param.
 */
import { toApiError } from './errors';

export interface PaginationMeta {
  pagination?: {
    nextCursor?: string | null;
    prevCursor?: string | null;
    limit?: number;
  };
  nextCursor?: string | null;
  prevCursor?: string | null;
  total?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface ListEnvelope<T> {
  data?: T[];
  meta?: PaginationMeta;
}

/** The subset of an `openapi-fetch` GET call's resolved value `paginate` needs. */
export interface FetchPageResult<T> {
  data?: ListEnvelope<T>;
  error?: unknown;
  response: Response;
}

function nextCursorOf(meta: PaginationMeta | undefined): string | undefined {
  const cursor = meta?.pagination?.nextCursor ?? meta?.nextCursor ?? null;
  return cursor ?? undefined;
}

/**
 * Walks every page of a cursor-paginated list, yielding one item at a time.
 *
 *     for await (const appointment of paginate((cursor) =>
 *       api.GET('/appointments', { params: { query: { cursor, limit: 100 } } }),
 *     )) {
 *       console.log(appointment.id);
 *     }
 *
 * CURSOR IS THE MINORITY SHAPE, so check the route before reaching for this.
 * Measured against the published contract: exactly two operations take a
 * `cursor` — `GET /appointments` and `GET /conversations/{id}/messages`.
 * Fifteen take `offset`/`limit` (`/stock`, `/vehicles`, `/contacts/search`,
 * `/webhooks/{id}/deliveries` and the rest), and others take `page`/`page_size`
 * (`/leads` among them). Passing `cursor` to one of those is a type error, not
 * a silent first page — which is the point of generating this package from the
 * contract.
 *
 * `fetchPage` is any typed `api.GET(...)` call, called once per page with
 * the previous page's cursor (`undefined` for the first page). Throws a
 * typed `VitrinaApiError` if a page comes back as an error, same as
 * `unwrap()`.
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<FetchPageResult<T>>,
): AsyncGenerator<T, void, unknown> {
  let cursor: string | undefined;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- pages are inherently sequential (each cursor depends on the last)
    const result = await fetchPage(cursor);
    if (result.error !== undefined) {
      throw toApiError(result.response.status, result.error);
    }
    const page = result.data;
    if (!page || !Array.isArray(page.data)) return;
    for (const item of page.data) yield item;
    const next = nextCursorOf(page.meta);
    if (!next) return;
    cursor = next;
  }
}

/** Same as `paginate`, but collects every page into one array. Only reach
 *  for this on a list you know is bounded — an unbounded one belongs on the
 *  `for await` form above. */
export async function paginateAll<T>(
  fetchPage: (cursor: string | undefined) => Promise<FetchPageResult<T>>,
): Promise<T[]> {
  const items: T[] = [];
  // eslint-disable-next-line no-restricted-syntax -- collecting an async generator IS the sequential-await case for-await exists for
  for await (const item of paginate(fetchPage)) items.push(item);
  return items;
}
