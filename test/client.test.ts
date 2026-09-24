import { describe, expect, it, vi } from 'vitest';

import { createClient } from '../src/client';

describe('createClient', () => {
  it('sends `Authorization: Bearer <apiKey>` on every call', async () => {
    const fetchMock = vi.fn(async (input: Request) => {
      expect(input.headers.get('authorization')).toBe('Bearer sk_test_123');
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const client = createClient({
      baseUrl: 'https://api.example.test/api/v1',
      apiKey: 'sk_test_123',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.GET('/locations');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a raw `bearer` token as an alternative to `apiKey`', async () => {
    const fetchMock = vi.fn(async (input: Request) => {
      expect(input.headers.get('authorization')).toBe('Bearer jwt-token');
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    const client = createClient({
      baseUrl: 'https://api.example.test/api/v1',
      bearer: 'jwt-token',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.GET('/locations');
  });

  it('rejects passing both `apiKey` and `bearer`', () => {
    expect(() =>
      createClient({
        baseUrl: 'https://api.example.test/api/v1',
        apiKey: 'a',
        bearer: 'b',
      }),
    ).toThrow(RangeError);
  });

  it('exposes an `events` namespace on the returned client', () => {
    const client = createClient({
      baseUrl: 'https://api.example.test/api/v1',
      apiKey: 'sk_test',
    });
    expect(typeof client.events.verifySignature).toBe('function');
    expect(typeof client.events.constructEvent).toBe('function');
  });
});
