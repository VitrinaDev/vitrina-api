/**
 * `@vitrina/api` — the typed TypeScript SDK for the Vitrina API pública
 * (ADR 0106 §5.3). Generated from the COMMITTED `openapi.public.json`, never
 * a live server; see `../scripts/generate-types.ts`.
 *
 * See `/docs/sdk` for the install + quickstart, `/docs/webhooks` for the
 * Evento envelope, and `/docs/errores` for the error catalogue.
 */
export { createClient } from './client';
export type {
  CreateClientOptions,
  VitrinaClient,
  VitrinaEventsNamespace,
} from './client';

export type { paths, components, operations } from './generated/api-types';

export {
  ERROR_CODES,
  OutboundVerdictError,
  toApiError,
  unwrap,
  VitrinaApiError,
} from './errors';
export type {
  ApiErrorBody,
  ApiErrorOptions,
  ErrorCode,
  OpenErrorCode,
  OutboundVerdictReason,
  UnwrappableResult,
} from './errors';

export { paginate, paginateAll } from './pagination';
export type {
  FetchPageResult,
  ListEnvelope,
  PaginationMeta,
} from './pagination';

export { generateIdempotencyKey, idempotencyKey } from './idempotency';
export type { IdempotencyKeyHeader } from './idempotency';

export {
  constructEventEnvelope,
  verifyWebhookSignature,
  WebhookSignatureError,
} from './webhooks';
export type {
  DataOmittedReason,
  VerifyResult,
  VerifySignatureOptions,
  WebhookEventAuthor,
  WebhookEventEnvelope,
  WebhookEventResource,
} from './webhooks';

export { EventResourceUnavailableError } from './events';
export type { VitrinaEvent } from './events';
