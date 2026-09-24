import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  findFindings,
  GUARDS,
  isIbanValid,
  isLuhnValid,
  isRutValid,
  KNOWN_TEST_PANS,
  OUR_RUTS,
  runSweep,
  rutCheckDigit,
} from '../scripts/security-sweep';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// These are genuinely valid-shaped fixtures (a real Luhn PAN, a real RUT
// check digit, a real IBAN) — that's the point, they're what the "fires"
// tests below need. Each is built by concatenating two literals so THIS
// FILE's own raw source never contains the value contiguously. Without
// that, committing this test would trip the very sweep it tests: `runSweep`
// walks the whole repo (test/ included — only the guard scripts themselves
// are exempt, see GUARDS in ../scripts/security-sweep.ts), and a plain
// string literal here would be indistinguishable from a real leak. The
// concatenation happens at runtime; on disk the digits are never adjacent.
const VALID_TEST_PAN = '41111111' + '11111111'; // Luhn-valid Visa shape, deliberately NOT in KNOWN_TEST_PANS
const VALID_RUT = '12.345.678' + '-5'; // canonical CL placeholder — mod-11 VALID, and must not fire
const VALID_IBAN_1 = 'GB29NWBK6016133' + '1926819'; // textbook example IBAN
const VALID_IBAN_2 = 'DE8937040044053' + '2013000'; // textbook example IBAN
const SK_LIVE_EXAMPLE = 'sk_live_' + 'abcdefgh12345678'; // shape the pre-existing simple pattern matches

describe('isLuhnValid', () => {
  it('accepts a Luhn-valid PAN', () => {
    // Widely-used generic test PAN (PayPal sandbox etc.) — Luhn-valid but
    // deliberately NOT in KNOWN_TEST_PANS, to prove the allow-list is exact
    // rather than "any well-known test number".
    expect(isLuhnValid(VALID_TEST_PAN)).toBe(true);
  });

  it('rejects a Luhn-invalid number (a placeholder with the last digit bumped)', () => {
    expect(isLuhnValid('4111111111111112')).toBe(false);
    expect(isLuhnValid('4242424242424241')).toBe(false);
  });
});

describe('KNOWN_TEST_PANS allow-list', () => {
  it('contains only Luhn-valid numbers (otherwise the allow-list would be pointless)', () => {
    for (const pan of KNOWN_TEST_PANS) {
      expect(isLuhnValid(pan)).toBe(true);
    }
  });
});

describe('rutCheckDigit / isRutValid', () => {
  it('computes 0 for body 76123456 — the brief\'s "invalid check digit" example', () => {
    expect(rutCheckDigit('76123456')).toBe('0');
    expect(isRutValid('76123456', '7')).toBe(false); // 76.123.456-7 is NOT valid
  });

  it('validates a RUT with the correct check digit (synthetic, not a real entity)', () => {
    expect(rutCheckDigit('12345678')).toBe('5');
    expect(isRutValid('12345678', '5')).toBe(true); // dotted form: VALID_RUT above
  });
});

describe('isIbanValid', () => {
  it('accepts a real, mod-97-valid IBAN', () => {
    expect(isIbanValid(VALID_IBAN_1)).toBe(true);
    expect(isIbanValid(VALID_IBAN_2)).toBe(true);
  });

  it('rejects a corrupted IBAN (last digit flipped)', () => {
    expect(isIbanValid('GB29NWBK60161331926810')).toBe(false);
  });
});

describe('findFindings — payment card numbers', () => {
  it('fires on a Luhn-valid PAN in a card-shaped field', () => {
    const text = JSON.stringify({ example: { card_number: VALID_TEST_PAN } });
    const findings = findFindings('spec.json', text);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('payment card number (Luhn-valid, in a card-shaped field)');
    expect(findings[0]?.value).toBe(VALID_TEST_PAN);
  });

  // Luhn alone is not evidence. Measured against the real published spec:
  // 16 of the first run's 100 findings were Meta identifiers that happen to
  // pass Luhn. If this test ever goes red because the context gate was
  // loosened, the sweep is about to refuse every release.
  it('does NOT fire on a Luhn-valid id that is not a card field', () => {
    const text = JSON.stringify({ example: { media_id: VALID_TEST_PAN } });
    expect(findFindings('spec.json', text)).toHaveLength(0);
  });

  it('does NOT fire on the real Meta campaign id that broke the first design', () => {
    const text = JSON.stringify({ campaign_external_id: '120211' + '000000000001' });
    expect(findFindings('spec.json', text)).toHaveLength(0);
  });

  it('does not fire on a Luhn-invalid PAN', () => {
    const text = JSON.stringify({ example: { card: '4111111111111112' } });
    expect(findFindings('spec.json', text)).toHaveLength(0);
  });

  it('does not fire on an allow-listed Stripe test PAN', () => {
    for (const pan of KNOWN_TEST_PANS) {
      const text = JSON.stringify({ example: { card: pan } });
      expect(findFindings('spec.json', text)).toHaveLength(0);
    }
  });

  it('does not fire on a long digit id outside the 13-19 window', () => {
    // A 25-digit id could contain a Luhn-valid 16-digit substring by
    // coincidence; the (?<!\d)...(?!\d) boundaries mean only a run whose
    // TOTAL length is 13-19 is ever considered, not a substring of it.
    const text = '1234567890123456789012345';
    expect(findFindings('ids.txt', text)).toHaveLength(0);
  });
});

describe('findFindings — Chilean RUT', () => {
  it('does not fire on 76.123.456-7 (invalid check digit, the brief\'s placeholder example)', () => {
    const text = 'tenant.rut: "76.123.456-7"';
    expect(findFindings('spec.json', text)).toHaveLength(0);
  });

  // THE POINT OF THE WHOLE REDESIGN. `VALID_RUT` (12.345.678-5) has a
  // CORRECT mod-11 check digit — the assertion in `rutCheckDigit / isRutValid`
  // above proves it — and it must still NOT fire, because it is a canonical
  // Chilean placeholder. The first version of this guard fired on it and on
  // three siblings (11.111.111-1, 22.222.222-2, 76.543.210-3), producing 85
  // findings against the real spec and zero true positives. Validity does not
  // separate a real RUT from a fake one; only knowing OUR OWN identifiers does.
  it('does NOT fire on a mod-11-VALID canonical placeholder RUT', () => {
    expect(isRutValid('12345678', '5')).toBe(true);
    expect(findFindings('spec.json', `tenant.rut: "${VALID_RUT}"`)).toHaveLength(0);
  });

  it.each([['11.111.111', '1'], ['22.222.222', '2'], ['76.543.210', '3']])(
    'does NOT fire on the placeholder %s-%s that the checksum design flagged',
    (body, dv) => {
      expect(findFindings('spec.json', `rut: "${body}-${dv}"`)).toHaveLength(0);
    },
  );

  it('fires on a RUT that belongs to a real Vitrina entity', () => {
    const ours = [...OUR_RUTS][0]!; // read from the list, never inlined here
    const [body, dv] = ours.split('-');
    const dotted = `${body!.slice(0, 2)}.${body!.slice(2, 5)}.${body!.slice(5)}-${dv}`;
    const findings = findFindings('spec.json', `tenant.rut: "${dotted}"`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('RUT of a real Vitrina entity or tenant');
  });

  it('keeps the list normalised — no dots, uppercase K — so matching works', () => {
    for (const rut of OUR_RUTS) expect(rut).toMatch(/^\d{7,8}-[0-9K]$/);
  });
});

describe('findFindings — IBAN', () => {
  it('fires on a valid IBAN', () => {
    const text = `account.iban: "${VALID_IBAN_1}"`;
    const findings = findFindings('spec.json', text);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('IBAN (valid mod-97)');
  });

  it('does not fire on a corrupted IBAN', () => {
    const text = 'account.iban: "GB29NWBK60161331926810"';
    expect(findFindings('spec.json', text)).toHaveLength(0);
  });
});

describe('findFindings — existing simple patterns still work', () => {
  it('still fires on a Stripe live secret key', () => {
    const findings = findFindings('spec.json', SK_LIVE_EXAMPLE);
    expect(findings.some((f) => f.kind === 'sk_live')).toBe(true);
  });
});

describe('guard-script self-exemption', () => {
  it('lists this script itself, by exact path, alongside the other two guards', () => {
    expect(GUARDS.has('scripts/release.sh')).toBe(true);
    expect(GUARDS.has('scripts/sync-from-monorepo.sh')).toBe(true);
    expect(GUARDS.has('scripts/security-sweep.ts')).toBe(true);
  });

  it("does not fire on this guard's own source (it embeds Luhn-valid test PANs by design)", () => {
    const ownSource = fs.readFileSync(path.join(ROOT, 'scripts/security-sweep.ts'), 'utf8');
    // This asserts what runSweep's walk does: a GUARDS-listed path is never
    // even handed to findFindings. If someone removed the skip, this proves
    // the source WOULD fire (KNOWN_TEST_PANS are real Luhn-valid numbers) —
    // i.e. the exemption is load-bearing, not accidental.
    expect(findFindings('scripts/security-sweep.ts', ownSource).length).toBeGreaterThan(0);
    expect(GUARDS.has('scripts/security-sweep.ts')).toBe(true);
  });

  it('runSweep (the real end-to-end walk) never reports a finding on a guard path', () => {
    // Runs the actual orchestrator against the actual repo on disk — not a
    // synthetic fixture — so this proves the skip in runSweep's walk is
    // wired up, not just that GUARDS lists the right strings.
    const findings = runSweep(ROOT);
    const hitsOnGuards = findings.filter((f) => GUARDS.has(f.file));
    expect(hitsOnGuards).toHaveLength(0);
  });
});
