#!/usr/bin/env node
// Release-time security sweep — the last line of defence before a PUBLIC
// tag. `release.sh` calls this right after `pnpm run test`, before `git
// commit` / `git tag` / `git push`. It walks every file in this repository
// (except node_modules/.git, and the guard scripts themselves — see
// GUARDS below) and refuses the release if anything here must never reach
// a published npm package or docs.vitrinadev.com.
//
// Two families of check:
//
//  - SIMPLE_PATTERNS: shape-only regexes. A JWT looks like a JWT; a live
//    Stripe secret key looks like one. There is no legitimate placeholder
//    that has this shape, so shape alone is enough to refuse.
//
//  - the PAN / RUT / IBAN detectors below are shape-PLUS-VALIDITY. A
//    deliberate placeholder ("4111-1111-1111-1234", "76.123.456-7") is
//    exactly what we WANT in a published example, and a naive shape-only
//    regex would refuse every release that has one — which is how a sweep
//    gets disabled. Each of these runs the real checksum (Luhn / mod-11 /
//    mod-97) and only fires when the value would actually validate, i.e.
//    it looks like it came from a real card, a real Chilean RUT, or a
//    real bank account — not an invented one. See each section for the
//    exact reason a placeholder cannot trip it.
//
// This file is a guard script (KNOWN_TEST_PANS below are real Luhn-valid
// numbers, by design — see that section), so it is exempt from its own
// sweep, the same way release.sh and sync-from-monorepo.sh are: see GUARDS.
//
// Extracted from release.sh (was an inline `node -e` block, credential- and
// customer-name-only) so these detectors are unit-testable without running
// a release — see test/security-sweep.test.ts, including a negative test
// that this file's own source does not trip its own detectors.
//
// Usage: `node scripts/security-sweep.ts` from the repo root (Node 24 runs
// .ts directly), or via release.sh. Exits 1 and prints every finding on a
// hit; exits 0 and prints "sweep clean" otherwise.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The guard scripts are skipped because they CONTAIN the patterns they
// search for — a sweep that flags its own detection list reports a leak
// every time and teaches everyone to ignore it. This is the only
// exemption, and it is by exact path so a third script cannot quietly
// inherit it. That already cost a release once; keep this list exact.
export const GUARDS = new Set([
  'scripts/release.sh',
  'scripts/sync-from-monorepo.sh',
  'scripts/security-sweep.ts',
]);

// ---------------------------------------------------------------------------
// Simple shape-only patterns — unchanged from the original inline sweep in
// release.sh. Nothing here has a legitimate "placeholder" form.
// ---------------------------------------------------------------------------
const SIMPLE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, 'JWT'],
  [/\b(Lovende|Alport|Compra ?Justa|Auteria|Auva|Andes Salud)\b/i, 'customer name'],
  [/sk_live_[A-Za-z0-9]{8,}/, 'sk_live'],
  [/sb_secret_/, 'sb_secret'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'private key'],
];

// ---------------------------------------------------------------------------
// Payment card numbers — Luhn.
//
// Shape alone (13-19 digits) is worthless: a database id can be 16 digits.
// A real PAN passes the Luhn checksum; a deliberate placeholder ("bump the
// last digit") does not, by construction. So this only fires on 13-19 digit
// runs that pass Luhn, which is precisely the set of "looks like it could
// actually charge a card."
// ---------------------------------------------------------------------------

// Stripe's own published test PANs (https://docs.stripe.com/testing). Every
// one of these passes Luhn BY DESIGN — that is what makes them useful as
// test numbers, since client-side "is this well-formed" validation has to
// accept them — but none of them is a real, chargeable card. Allow-listed
// by exact digit string so a docs example using one of these doesn't refuse
// the release. Anything else that happens to pass Luhn is NOT on this list
// and will fire, including other widely-used generic test numbers such as
// 4111111111111111 (see test/security-sweep.test.ts).
export const KNOWN_TEST_PANS: ReadonlySet<string> = new Set([
  '4242424242424242', // Visa
  '4000000000000002', // Visa — generic decline
  '4000056655665556', // Visa — debit
  '5555555555554444', // Mastercard
  '5200828282828210', // Mastercard — debit
  '2223003122003222', // Mastercard — 2-series
  '378282246310005', // American Express
  '371449635398431', // American Express
  '6011111111111117', // Discover
  '30569309025904', // Diners Club
  '3566002020360505', // JCB
]);

export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Chilean RUT — a HAND-KEPT list of OUR entities, not a checksum.
//
// THE OBVIOUS DESIGN IS WRONG AND WAS TRIED FIRST. "A real RUT validates
// against mod-11, an invented placeholder does not" sounds right and is
// false: the placeholders Chilean systems actually use — 11.111.111-1,
// 22.222.222-2, 12.345.678-5, 76.543.210-3 — are all mod-11 VALID, because
// anyone writing a fake RUT for a form to accept has to make it validate.
// Running the checksum version against the real spec produced 85 RUT
// findings, every one of them a canonical test value and not one of them a
// leak. Validity does not separate real from fake here; it only separates
// "well-formed" from "typo".
//
// So this mirrors the customer-name list above, which has the same shape of
// risk and a false-positive rate of zero: name the identifiers that are
// ACTUALLY ours. The cost is that onboarding a tenant means adding a line —
// the same hand-kept weakness the customer-name check carries, accepted for
// the same reason (the tenant table is prod data this repo cannot reach).
//
// `rutCheckDigit` / `isRutValid` are kept and exported because the TEST
// suite uses them to prove the placeholders above really are valid — which
// is the whole reason this list exists rather than a checksum.
// ---------------------------------------------------------------------------

// Normalised `<body>-<DV>`, no dots, uppercase K.
export const OUR_RUTS: ReadonlySet<string> = new Set([
  '78482522-1', // Vitrina SpA
  '77494831-7', // MGM Automotora
]);

// A Luhn-valid run only counts as a card if something within the preceding
// ~48 characters claims it is one. `media_id` and `campaign_external_id` do
// not; `card_number`, `pan`, `tarjeta` do.
const CARD_CONTEXT_RE = /\b(card|pan|tarjeta|credit|debit)\w*\b[^\n]{0,24}$/i;

export function rutCheckDigit(body: string): string {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += (body.charCodeAt(i) - 48) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return '0';
  if (res === 10) return 'K';
  return String(res);
}

export function isRutValid(body: string, checkDigit: string): boolean {
  return rutCheckDigit(body) === checkDigit.toUpperCase();
}

// ---------------------------------------------------------------------------
// IBAN — mod-97 == 1.
//
// Same logic as the RUT check: a real IBAN's check digits satisfy mod-97
// == 1 by construction (that is the entire point of the ISO 7064 checksum);
// a corrupted or invented one essentially never does (roughly 1-in-97
// odds). Only a mod-97-valid candidate fires.
// ---------------------------------------------------------------------------
export function isIbanValid(candidate: string): boolean {
  const s = candidate.toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      remainder = (remainder * 10 + (code - 48)) % 97;
    } else {
      const val = code - 55; // 'A' -> 10 .. 'Z' -> 35
      remainder = (remainder * 10 + Math.floor(val / 10)) % 97;
      remainder = (remainder * 10 + (val % 10)) % 97;
    }
  }
  return remainder === 1;
}

// ---------------------------------------------------------------------------
// Candidate extraction — deliberately narrow shapes. Validity does the
// filtering; the regex only has to find plausible candidates.
// ---------------------------------------------------------------------------
const PAN_RE = /(?<!\d)\d{13,19}(?!\d)/g;
const RUT_RE = /\b(\d{1,2}\.\d{3}\.\d{3})-([0-9kK])\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

export interface Finding {
  file: string;
  line: number;
  value: string;
  kind: string;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function findFindings(relPath: string, text: string): Finding[] {
  const findings: Finding[] = [];

  for (const [re, name] of SIMPLE_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      findings.push({ file: relPath, line: lineAt(text, m.index), value: m[0], kind: name });
    }
  }

  for (const m of text.matchAll(PAN_RE)) {
    const digits = m[0];
    if (KNOWN_TEST_PANS.has(digits)) continue;
    if (!isLuhnValid(digits)) continue;
    // Luhn is NOT sufficient on its own — measured, not assumed. Roughly one
    // in ten arbitrary digit runs passes it, and this spec is full of long
    // external ids: `campaign_external_id: "120211000000000001"` and
    // `media_id: "2038475610394856"` are Meta identifiers that happen to be
    // Luhn-valid, and they produced 16 of the first run's 100 findings. A
    // guard that cries wolf on every release is a guard someone disables, so
    // the number must ALSO sit next to something that claims to be a card.
    if (!CARD_CONTEXT_RE.test(text.slice(Math.max(0, m.index - 48), m.index))) continue;
    findings.push({
      file: relPath,
      line: lineAt(text, m.index),
      value: digits,
      kind: 'payment card number (Luhn-valid, in a card-shaped field)',
    });
  }

  for (const m of text.matchAll(RUT_RE)) {
    const normalised = `${m[1].replace(/\./g, '')}-${m[2].toUpperCase()}`;
    if (OUR_RUTS.has(normalised)) {
      findings.push({
        file: relPath,
        line: lineAt(text, m.index),
        value: m[0],
        kind: 'RUT of a real Vitrina entity or tenant',
      });
    }
  }

  for (const m of text.matchAll(IBAN_RE)) {
    if (isIbanValid(m[0])) {
      findings.push({
        file: relPath,
        line: lineAt(text, m.index),
        value: m[0],
        kind: 'IBAN (valid mod-97)',
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Walk + orchestration. Same file set the original inline sweep used: every
// file under the repo root except node_modules/ and .git/, skipping the
// GUARDS by exact relative path.
// ---------------------------------------------------------------------------
function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(node_modules|\.git)$/.test(entry.name)) walk(full, out);
      continue;
    }
    out.push(full);
  }
}

export function collectFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, out);
  return out;
}

export function runSweep(root: string = HERE): Finding[] {
  const findings: Finding[] = [];
  for (const full of collectFiles(root)) {
    const rel = path.relative(root, full);
    if (GUARDS.has(rel)) continue;
    const text = fs.readFileSync(full, 'utf8');
    findings.push(...findFindings(rel, text));
  }
  return findings;
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const findings = runSweep(HERE);
  if (findings.length > 0) {
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}: ${f.kind} — ${f.value}`);
    }
    console.error(`REFUSING TO TAG: ${findings.length} finding(s) in a repository that is public.`);
    console.error(
      'Replace each offending value with a placeholder that FAILS its own validity check ' +
        '(an invalid Luhn digit, an invalid RUT check digit, a corrupted IBAN mod-97) so the ' +
        'example is obviously fake to both a reader and this sweep.',
    );
    process.exit(1);
  }
  console.log('sweep clean');
}
