import type { ApiErrorBody } from './types.js';

/**
 * Base class for every error thrown by the SDK that originates from a
 * non-2xx HTTP response or a transport-level failure.
 *
 * All sub-classes preserve `status`, `code`, the parsed JSON `body` (if any),
 * and the `requestId` echoed by the gateway.
 */
export class ScoopeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody | undefined;
  readonly requestId: string | undefined;
  override cause?: unknown;

  constructor(opts: {
    message: string;
    status: number;
    code?: string;
    body?: ApiErrorBody;
    requestId?: string;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'ScoopeError';
    this.status = opts.status;
    this.code = opts.code ?? body_code(opts.body) ?? 'unknown';
    this.body = opts.body;
    this.requestId = opts.requestId;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export class AuthenticationError extends ScoopeError {
  constructor(opts: ConstructorParameters<typeof ScoopeError>[0]) {
    super(opts);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ScoopeError {
  constructor(opts: ConstructorParameters<typeof ScoopeError>[0]) {
    super(opts);
    this.name = 'AuthorizationError';
  }
}

export class ValidationError extends ScoopeError {
  constructor(opts: ConstructorParameters<typeof ScoopeError>[0]) {
    super(opts);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends ScoopeError {
  /** Seconds the gateway suggests waiting before retrying. */
  readonly retryAfter: number | undefined;
  constructor(
    opts: ConstructorParameters<typeof ScoopeError>[0] & { retryAfter?: number },
  ) {
    super(opts);
    this.name = 'RateLimitError';
    this.retryAfter = opts.retryAfter;
  }
}

export class QuotaExceededError extends ScoopeError {
  /** The specific Stripe meter that hit its plan cap (e.g. `tool_calls`). */
  readonly meter: string | undefined;
  constructor(opts: ConstructorParameters<typeof ScoopeError>[0] & { meter?: string }) {
    super(opts);
    this.name = 'QuotaExceededError';
    this.meter = opts.meter;
  }
}

export class ServerError extends ScoopeError {
  constructor(opts: ConstructorParameters<typeof ScoopeError>[0]) {
    super(opts);
    this.name = 'ServerError';
  }
}

export class NotFoundError extends ScoopeError {
  constructor(opts: ConstructorParameters<typeof ScoopeError>[0]) {
    super(opts);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ScoopeError {
  constructor(opts: ConstructorParameters<typeof ScoopeError>[0]) {
    super(opts);
    this.name = 'ConflictError';
  }
}

export class NetworkError extends ScoopeError {
  constructor(opts: { message: string; cause?: unknown }) {
    super({ message: opts.message, status: 0, code: 'network_error', cause: opts.cause });
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends ScoopeError {
  constructor(message = 'Request timed out.') {
    super({ message, status: 0, code: 'timeout' });
    this.name = 'TimeoutError';
  }
}

function body_code(body?: ApiErrorBody): string | undefined {
  return body?.code;
}

/**
 * Map an HTTP response into the right SDK error subclass.
 * Centralised here so every resource gets the same behaviour.
 */
export function errorFromResponse(args: {
  status: number;
  body: ApiErrorBody | undefined;
  headers: Headers;
  requestId: string | undefined;
}): ScoopeError {
  const { status, body, headers, requestId } = args;
  const message = body?.message ?? `HTTP ${status}`;
  const code = body?.code;
  const common = { status, code, body, requestId, message };

  if (status === 401) return new AuthenticationError(common);
  if (status === 403) return new AuthorizationError(common);
  if (status === 404) return new NotFoundError(common);
  if (status === 409) return new ConflictError(common);
  if (status === 400 || status === 422) return new ValidationError(common);

  if (status === 429) {
    const quota = headers.get('x-quota-exceeded');
    if (quota || code === 'quota_exceeded') {
      return new QuotaExceededError({
        ...common,
        meter: quota ?? extractMeter(body),
      });
    }
    const retryAfter = parseRetryAfter(headers.get('retry-after'));
    return new RateLimitError({ ...common, retryAfter });
  }

  if (status >= 500) return new ServerError(common);
  return new ScoopeError(common);
}

function extractMeter(body: ApiErrorBody | undefined): string | undefined {
  const d = body?.details;
  if (d && typeof d === 'object' && 'meter' in d) {
    const m = (d as { meter?: unknown }).meter;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  // HTTP-date form
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return undefined;
}
