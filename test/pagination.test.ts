import { describe, expect, it } from 'vitest';

import { VitrinaApiError } from '../src/errors';
import { paginate, paginateAll, type FetchPageResult } from '../src/pagination';

function page<T>(
  items: T[],
  nextCursor: string | null,
  status = 200,
): FetchPageResult<T> {
  return {
    data: {
      data: items,
      meta: { pagination: { nextCursor, limit: items.length } },
    },
    response: new Response(null, { status }),
  };
}

describe('paginate', () => {
  it('walks every page via meta.pagination.nextCursor and yields items in order', async () => {
    const pages: Record<string, FetchPageResult<number>> = {
      first: page([1, 2], 'cursor-2'),
      'cursor-2': page([3, 4], null),
    };
    const seenCursors: (string | undefined)[] = [];
    const fetchPage = async (cursor: string | undefined) => {
      seenCursors.push(cursor);
      return pages[cursor ?? 'first'];
    };

    const items: number[] = [];
    for await (const item of paginate(fetchPage)) items.push(item);

    expect(items).toEqual([1, 2, 3, 4]);
    expect(seenCursors).toEqual([undefined, 'cursor-2']);
  });

  it('falls back to a flat meta.nextCursor when there is no meta.pagination', async () => {
    const fetchPage = async (cursor: string | undefined) =>
      cursor === undefined
        ? {
            data: { data: ['a'], meta: { nextCursor: 'flat-2' } },
            response: new Response(null, { status: 200 }),
          }
        : {
            data: { data: ['b'], meta: { nextCursor: null } },
            response: new Response(null, { status: 200 }),
          };

    expect(await paginateAll(fetchPage)).toEqual(['a', 'b']);
  });

  it('stops with no items when the first page has no `data` array', async () => {
    const fetchPage = async () => ({
      data: {},
      response: new Response(null, { status: 200 }),
    });
    expect(await paginateAll(fetchPage)).toEqual([]);
  });

  it('throws a typed error when a page comes back as an API error', async () => {
    const fetchPage = async () => ({
      error: { error: { code: 'FORBIDDEN', message: 'no scope' } },
      response: new Response(null, { status: 403 }),
    });
    await expect(paginateAll(fetchPage)).rejects.toBeInstanceOf(
      VitrinaApiError,
    );
  });
});
