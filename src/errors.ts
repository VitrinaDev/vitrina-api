/**
 * Typed errors over the API's one error envelope: `{ error: { code, message,
 * details?, field_errors?, requestId?, ...extensions } }` (`src/errors/
 * index.ts` + `src/middlewares/error-handler.ts` in vitrina-app). `code` is
 * generated from the committed error catalogue (see `generated/error-codes.ts`
 * and `../scripts/generate-error-codes.ts`) but kept OPEN at the type level —
 * `ErrorCode | (string & Record<string, never>)` — because a server release
 * can ship a new code before this SDK is regenerated; never treat the union
 * as exhaustive at runtime (no `switch` without a `default`).
 */
import { ERROR_CODES, type ErrorCode } from './generated/error-codes';

export { ERROR_CODES };
export type { ErrorCode };

/** `error.code`, widened so an unrecognised future code still type-checks.
 *  The `Record<string, never>` intersection (not a bare `{}`) is what keeps
 *  known `ErrorCode` literals showing up in autocomplete while still
 *  accepting any string. */
export type OpenErrorCode = ErrorCode | (string & Record<string, never>);

/** One entry of `error.details.reasons` on an outbound-policy verdict (C4). */
export interface OutboundVerdictReason {
  code: string;
  kind: 'bloqueo' | 'advertencia';
  hint: string;
  detail?: string;
}

/** The wire shape of `error` inside the envelope. */
export interface ApiErrorBody {
  code: OpenErrorCode;
  message: string;
  details?: unknown;
  field_errors?: Record<string, string>;
  requestId?: string;
  /** Send-verdict envelopes (C4) put `reasons`/`hint` at this level too. */
  reasons?: OutboundVerdictReason[];
  hint?: string;
  [key: string]: unknown;
}

export interface ApiErrorOptions {
  requestUrl?: string;
  requestMethod?: string;
}

/** Base class for every error this SDK throws for a non-2xx API response. */
export class VitrinaApiError extends Error {
  /** The catalogue code — branch on this, never on `message`. */
  readonly code: OpenErrorCode;

  /** HTTP status of the response that produced this error. */
  readonly status: number;

  readonly details?: unknown;

  readonly fieldErrors?: Record<string, string>;

  /** Correlates this failure with the server's own logs. */
  readonly requestId?: string;

  /** The full parsed `error` object, for anything not surfaced above. */
  readonly body: ApiErrorBody;

  readonly requestUrl?: string;

  readonly requestMethod?: string;

  constructor(
    status: number,
    body: ApiErrorBody,
    options: ApiErrorOptions = {},
  ) {
    super(body.message || `Vitrina API error ${body.code} (HTTP ${status})`);
    this.name = 'VitrinaApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.fieldErrors = body.field_errors;
    this.requestId = body.requestId;
    this.body = body;
    this.requestUrl = options.requestUrl;
    this.requestMethod = options.requestMethod;
  }

  /** `429 RATE_LIMITED`. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** `401` — no credential, or one the server does not recognise. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** `403` — a real credential, missing the scope this call needs. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** `404 NOT_FOUND`. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** `409 IDEMPOTENCY_KEY_CONFLICT` — same `Idempotency-Key`, different body. */
  get isIdempotencyConflict(): boolean {
    return this.code === 'IDEMPOTENCY_KEY_CONFLICT';
  }
}

/**
 * `422 OUTBOUND_BLOCKED` (a Bloqueo, never overridable) or `409
 * OUTBOUND_WARNING` (an Advertencia — resend the same call with
 * `acknowledge: reasons.map(r => r.code)` in the body to proceed). Cross-
 * ticket contract C4 — `src/services/api-send-verdicts.ts` in vitrina-app.
 */
export class OutboundVerdictError extends VitrinaApiError {
  /** Every reason the send was stopped for, with its kind and hint. */
  readonly reasons: OutboundVerdictReason[];

  /** The first reason's hint, surfaced at the top level like the wire body. */
  readonly hint: string;

  constructor(
    status: number,
    body: ApiErrorBody,
    options: ApiErrorOptions = {},
  ) {
    super(status, body, options);
    this.name = 'OutboundVerdictError';
    const detailsReasons = (
      body.details as { reasons?: OutboundVerdictReason[] } | undefined
    )?.reasons;
    this.reasons = body.reasons ?? detailsReasons ?? [];
    this.hint = body.hint ?? this.reasons[0]?.hint ?? '';
  }

  /** A Bloqueo — the law, the customer or the provider already said no. */
  get isBlocked(): boolean {
    return this.code === 'OUTBOUND_BLOCKED';
  }

  /** An Advertencia — resend once with `acknowledge` to proceed. */
  get isWarning(): boolean {
    return this.code === 'OUTBOUND_WARNING';
  }

  /** `reasons` codes, ready to pass back as `{ acknowledge: [...] }`. */
  get acknowledgeCodes(): string[] {
    return this.reasons.map((r) => r.code);
  }
}

function asErrorBody(payload: unknown, status: number): ApiErrorBody {
  if (payload && typeof payload === 'object') {
    const maybeEnvelope = payload as { error?: unknown };
    const candidate =
      maybeEnvelope.error && typeof maybeEnvelope.error === 'object'
        ? (maybeEnvelope.error as Record<string, unknown>)
        : (payload as Record<string, unknown>);
    if (
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string'
    ) {
      return candidate as unknown as ApiErrorBody;
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: `HTTP ${status} with an unrecognised response body`,
  };
}

/** Turns a non-2xx response's status + parsed JSON body into a typed error. */
export function toApiError(
  status: number,
  payload: unknown,
  options: ApiErrorOptions = {},
): VitrinaApiError {
  const body = asErrorBody(payload, status);
  if (body.code === 'OUTBOUND_BLOCKED' || body.code === 'OUTBOUND_WARNING') {
    return new OutboundVerdictError(status, body, options);
  }
  return new VitrinaApiError(status, body, options);
}

/** The subset of an `openapi-fetch` call's resolved value `unwrap` needs. */
export interface UnwrappableResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * `const location = unwrap(await api.GET('/locations/{id}', ...))` — throws
 * a typed `VitrinaApiError` (or `OutboundVerdictError`) instead of making
 * every call site check `error` by hand. `openapi-fetch` itself never
 * throws; reach for the raw `{ data, error }` result directly when you want
 * that instead.
 */
export function unwrap<T>(
  result: UnwrappableResult<T>,
  options: ApiErrorOptions = {},
): T {
  if (result.error !== undefined) {
    throw toApiError(result.response.status, result.error, options);
  }
  if (result.data === undefined) {
    throw new VitrinaApiError(
      result.response.status,
      {
        code: 'INTERNAL_ERROR',
        message: 'Response had neither data nor error',
      },
      options,
    );
  }
  return result.data;
}
