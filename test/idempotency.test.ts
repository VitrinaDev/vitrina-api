import { describe, expect, it } from 'vitest';

import { generateIdempotencyKey, idempotencyKey } from '../src/idempotency';

describe('idempotencyKey', () => {
  it('returns a header object for a well-formed key', () => {
    expect(idempotencyKey('provision-user-2026-04-24')).toEqual({
      'Idempotency-Key': 'provision-user-2026-04-24',
    });
  });

  it('rejects a key shorter than 8 characters (server minLength)', () => {
    expect(() => idempotencyKey('short')).toThrow(RangeError);
  });

  it('rejects a key with characters outside [A-Za-z0-9_-] (server pattern)', () => {
    expect(() => idempotencyKey('has spaces here')).toThrow(RangeError);
    expect(() => idempotencyKey('has:colon:chars')).toThrow(RangeError);
  });

  it('rejects a key longer than 200 characters (server maxLength)', () => {
    expect(() => idempotencyKey('a'.repeat(201))).toThrow(RangeError);
  });
});

describe('generateIdempotencyKey', () => {
  it('generates a key that itself passes idempotencyKey()', () => {
    const key = generateIdempotencyKey();
    expect(() => idempotencyKey(key)).not.toThrow();
  });

  it('prefixes when asked, and still validates', () => {
    const key = generateIdempotencyKey('provision');
    expect(key.startsWith('provision-')).toBe(true);
    expect(() => idempotencyKey(key)).not.toThrow();
  });

  it('is unique per call', () => {
    expect(generateIdempotencyKey()).not.toBe(generateIdempotencyKey());
  });
});
