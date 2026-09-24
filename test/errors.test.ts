import { describe, expect, it } from 'vitest';

import {
  OutboundVerdictError,
  toApiError,
  unwrap,
  VitrinaApiError,
} from '../src/errors';

describe('toApiError', () => {
  it('wraps a plain error envelope in VitrinaApiError', () => {
    const err = toApiError(404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Sucursal no encontrada',
        requestId: 'req-1',
      },
    });
    expect(err).toBeInstanceOf(VitrinaApiError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Sucursal no encontrada');
    expect(err.requestId).toBe('req-1');
    expect(err.isNotFound).toBe(true);
  });

  it('accepts a bare `{code,message}` body (not wrapped in `error`)', () => {
    const err = toApiError(401, {
      code: 'UNAUTHORIZED',
      message: 'Missing bearer token',
    });
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.isUnauthorized).toBe(true);
  });

  it('falls back to INTERNAL_ERROR for an unrecognisable body', () => {
    const err = toApiError(502, '<html>gateway error</html>');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(502);
  });

  it('promotes OUTBOUND_BLOCKED to OutboundVerdictError with reasons/hint (C4)', () => {
    const err = toApiError(422, {
      error: {
        code: 'OUTBOUND_BLOCKED',
        message: 'Send blocked',
        hint: 'No se puede reenviar este mensaje',
        reasons: [
          {
            code: 'opt_out',
            kind: 'bloqueo',
            hint: 'El contacto se dio de baja',
          },
        ],
      },
    });
    expect(err).toBeInstanceOf(OutboundVerdictError);
    const verdict = err as OutboundVerdictError;
    expect(verdict.isBlocked).toBe(true);
    expect(verdict.isWarning).toBe(false);
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.acknowledgeCodes).toEqual(['opt_out']);
    expect(verdict.hint).toBe('No se puede reenviar este mensaje');
  });

  it('reads OUTBOUND_WARNING reasons from `details.reasons` too', () => {
    const err = toApiError(409, {
      error: {
        code: 'OUTBOUND_WARNING',
        message: 'Send warned',
        details: {
          reasons: [
            {
              code: 'stale_context',
              kind: 'advertencia',
              hint: 'Revisa el contexto',
            },
          ],
        },
      },
    }) as OutboundVerdictError;
    expect(err.isWarning).toBe(true);
    expect(err.acknowledgeCodes).toEqual(['stale_context']);
    expect(err.hint).toBe('Revisa el contexto');
  });
});

describe('unwrap', () => {
  it('returns `data` when there is no error', () => {
    const result = unwrap({
      data: { id: '1' },
      response: new Response(null, { status: 200 }),
    });
    expect(result).toEqual({ id: '1' });
  });

  it('throws a typed error when `error` is present', () => {
    expect(() =>
      unwrap({
        error: { error: { code: 'FORBIDDEN', message: 'nope' } },
        response: new Response(null, { status: 403 }),
      }),
    ).toThrow(VitrinaApiError);
  });

  it('throws when neither `data` nor `error` is present (malformed response)', () => {
    expect(() =>
      unwrap({ response: new Response(null, { status: 200 }) }),
    ).toThrow(VitrinaApiError);
  });
});
