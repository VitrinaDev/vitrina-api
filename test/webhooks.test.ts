import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  constructEventEnvelope,
  verifyWebhookSignature,
  WebhookSignatureError,
  type WebhookEventEnvelope,
} from '../src/webhooks';

// Signs a body exactly the way `webhook-dispatch.service.ts`'s `signPayload`
// does — `t=<ts>,v1=HMAC_SHA256(secret, "${ts}.${body}")` — WITHOUT importing
// that service (it pulls in Redis/BullMQ). The interop test that proves this
// SDK's verifier accepts a signature from the REAL producer function lives in
// the vitrina-app repo root: tests/api-sdk-webhook-signature.test.ts.
function sign(secret: string, body: string, timestamp: number): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({
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
} satisfies WebhookEventEnvelope);

describe('verifyWebhookSignature', () => {
  it('accepts a signature computed at "now"', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign(SECRET, BODY, now);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        signatureHeader: header,
        rawBody: BODY,
        nowUnix: now,
      }),
    ).toEqual({
      ok: true,
    });
  });

  it('rejects a tampered body', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign(SECRET, BODY, now);
    const tampered = BODY.replace('Camila', 'Camilo');
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        signatureHeader: header,
        rawBody: tampered,
        nowUnix: now,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects the wrong secret', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign(SECRET, BODY, now);
    expect(
      verifyWebhookSignature({
        secret: 'whsec_wrong',
        signatureHeader: header,
        rawBody: BODY,
        nowUnix: now,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a stale timestamp outside the tolerance window', () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const header = sign(SECRET, BODY, anHourAgo);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        signatureHeader: header,
        rawBody: BODY,
        nowUnix: anHourAgo + 3600,
      }),
    ).toEqual({ ok: false, reason: 'stale' });
  });

  it('accepts a signature at the edge of a custom tolerance', () => {
    const ts = Math.floor(Date.now() / 1000) - 100;
    const header = sign(SECRET, BODY, ts);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        signatureHeader: header,
        rawBody: BODY,
        nowUnix: ts + 100,
        toleranceSeconds: 100,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a malformed header', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        signatureHeader: 'not-a-real-header',
        rawBody: BODY,
      }),
    ).toEqual({ ok: false, reason: 'malformed_header' });
  });
});

describe('constructEventEnvelope', () => {
  it('parses the body when the signature is valid', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign(SECRET, BODY, now);
    const event = constructEventEnvelope({
      secret: SECRET,
      signatureHeader: header,
      rawBody: BODY,
      nowUnix: now,
    });
    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('contact.created');
    expect(event.resource.url).toBe(
      'https://api.example.test/api/v1/contacts/c1',
    );
  });

  it('throws WebhookSignatureError on a bad signature', () => {
    expect(() =>
      constructEventEnvelope({
        secret: 'wrong',
        signatureHeader: sign(SECRET, BODY, Math.floor(Date.now() / 1000)),
        rawBody: BODY,
      }),
    ).toThrow(WebhookSignatureError);
  });
});
