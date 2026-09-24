import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { VitrinaApiError } from '../src/errors';
import {
  createEventsNamespace,
  EventResourceUnavailableError,
} from '../src/events';
import type { WebhookEventEnvelope } from '../src/webhooks';

const SECRET = 'whsec_test';

function envelope(
  overrides: Partial<WebhookEventEnvelope> = {},
): WebhookEventEnvelope {
  return {
    id: 'evt_1',
    type: 'contact.created',
    version: 1,
    created_at: '2026-09-22T00:00:00.000Z',
    tenant_id: 'tenant-1',
    resource: {
      type: 'contact',
      id: 'c1',
      url: 'https://api.example.test/api/v1/contacts/c1',
    },
    author: { kind: 'api_key', id: 'k1', name: 'test key' },
    data: { id: 'c1', name: 'Camila' },
    ...overrides,
  };
}

function sign(body: string, timestamp: number): string {
  const mac = createHmac('sha256', SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

describe('events.constructEvent(...).fetch()', () => {
  it('GETs resource.url with the client headers and returns `data`', async () => {
    const body = JSON.stringify(envelope());
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.example.test/api/v1/contacts/c1');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer sk_test',
      );
      return new Response(
        JSON.stringify({ data: { id: 'c1', name: 'Camila Herrera' } }),
        { status: 200 },
      );
    });

    const events = createEventsNamespace({
      headers: { Authorization: 'Bearer sk_test' },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const event = events.constructEvent({
      secret: SECRET,
      signatureHeader: sign(body, now),
      rawBody: body,
      nowUnix: now,
    });

    const contact = await event.fetch<{ id: string; name: string }>();
    expect(contact).toEqual({ id: 'c1', name: 'Camila Herrera' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws EventResourceUnavailableError when resource.url is null (e.g. data_omitted)', async () => {
    const body = JSON.stringify(
      envelope({
        resource: { type: 'contact', id: null, url: null },
        data: undefined,
        data_omitted: 'sensitive',
      }),
    );
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn();
    const events = createEventsNamespace({
      headers: {},
      fetch: fetchMock as unknown as typeof fetch,
    });
    const event = events.constructEvent({
      secret: SECRET,
      signatureHeader: sign(body, now),
      rawBody: body,
      nowUnix: now,
    });

    await expect(event.fetch()).rejects.toBeInstanceOf(
      EventResourceUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a typed VitrinaApiError when the resource GET itself fails', async () => {
    const body = JSON.stringify(envelope());
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'FORBIDDEN', message: 'no scope' } }),
          { status: 403 },
        ),
    );
    const events = createEventsNamespace({
      headers: {},
      fetch: fetchMock as unknown as typeof fetch,
    });
    const event = events.constructEvent({
      secret: SECRET,
      signatureHeader: sign(body, now),
      rawBody: body,
      nowUnix: now,
    });

    await expect(event.fetch()).rejects.toBeInstanceOf(VitrinaApiError);
  });
});
