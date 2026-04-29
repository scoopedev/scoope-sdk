import {
  NetworkError,
  RateLimitError,
  ScoopeError,
  ServerError,
  TimeoutError,
  errorFromResponse,
  parseRetryAfter,
} from './errors.js';
import type { ResolvedClientConfig, RequestContext, ResponseContext } from './config.js';
import type { ApiErrorBody } from './types.js';
import { uuidv7 } from './uuid.js';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Idempotency:
   *  - omit / undefined: SDK auto-generates a UUID v7 for any mutating method
   *  - explicit string: that value is used verbatim
   *  - explicit `false`: header is *not* sent (caller knows what they're doing)
   */
  idempotencyKey?: string | false;
  /** Per-request override of `timeoutMs`. */
  timeoutMs?: number;
  /** Caller-supplied AbortSignal — composed with the timeout signal. */
  signal?: AbortSignal;
  /** Force-disable retries for this single call (e.g. for long-poll endpoints). */
  noRetry?: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export class HttpClient {
  constructor(private readonly cfg: ResolvedClientConfig) {}

  /**
   * Build the absolute URL — kept public so resources can use it for SSE/EventSource.
   */
  buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.cfg.baseUrl + (path.startsWith('/') ? path : '/' + path));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /**
   * Standard auth headers — also exposed for SSE which needs them on the EventSource.
   */
  authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'User-Agent': this.cfg.userAgent,
      ...this.cfg.defaultHeaders,
    };
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const idempotencyKey =
      opts.idempotencyKey === false
        ? undefined
        : opts.idempotencyKey ?? (MUTATING_METHODS.has(opts.method) ? uuidv7() : undefined);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.authHeaders(),
      ...(opts.headers ?? {}),
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const bodyString = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const maxAttempts = opts.noRetry ? 1 : Math.max(1, this.cfg.maxRetries + 1);

    let lastError: ScoopeError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const reqCtx: RequestContext = {
        url,
        method: opts.method,
        headers: { ...headers },
        attempt,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };

      const startedAt = now();
      let status = 0;
      let willRetry = false;
      let response: Response | undefined;
      let attemptError: ScoopeError | undefined;

      try {
        if (this.cfg.onRequest) await this.cfg.onRequest(reqCtx);

        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort(opts.signal?.reason);
        if (opts.signal) {
          if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
          else opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        const timeoutId =
          timeoutMs > 0
            ? setTimeout(() => ctrl.abort(new TimeoutError()), timeoutMs)
            : undefined;

        try {
          response = await this.cfg.fetch(url, {
            method: opts.method,
            headers,
            body: bodyString,
            signal: ctrl.signal,
          });
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        }

        status = response.status;
        if (response.ok) {
          if (status === 204) {
            await drainBody(response);
            await this.callOnResponse(reqCtx, status, startedAt, false);
            return undefined as unknown as T;
          }
          const json = await safeJson(response);
          await this.callOnResponse(reqCtx, status, startedAt, false);
          return json as T;
        }

        // Non-2xx: parse, classify, decide whether to retry.
        const parsed = await safeJson<ApiErrorBody>(response);
        const requestId = response.headers.get('x-request-id') ?? undefined;
        const err = errorFromResponse({
          status,
          body: parsed,
          headers: response.headers,
          requestId,
        });
        attemptError = err;
        const retryable = !opts.noRetry && shouldRetryHttp(err);
        willRetry = retryable && attempt < maxAttempts;

        if (!willRetry) {
          await this.callOnResponse(reqCtx, status, startedAt, false);
          throw err;
        }

        await this.callOnResponse(reqCtx, status, startedAt, true);
        const delay = computeBackoff({
          attempt,
          baseMs: this.cfg.retryBaseMs,
          retryAfterSeconds: err instanceof RateLimitError ? err.retryAfter : undefined,
        });
        await sleep(delay);
        lastError = err;
        continue;
      } catch (raw) {
        // We landed here either because:
        //  - we threw `err` ourselves above (already a ScoopeError, no retry left)
        //  - fetch / abort / network blew up
        if (attemptError && !willRetry) throw attemptError;

        const sErr = wrapTransportError(raw);
        const retryable = !opts.noRetry && sErr instanceof NetworkError;
        willRetry = retryable && attempt < maxAttempts;
        await this.callOnResponse(reqCtx, status, startedAt, willRetry);

        if (!willRetry) throw sErr;
        const delay = computeBackoff({ attempt, baseMs: this.cfg.retryBaseMs });
        await sleep(delay);
        lastError = sErr;
        continue;
      }
    }

    /* c8 ignore next 2 */
    throw lastError ?? new ServerError({ status: 0, message: 'Exhausted retries.' });
  }

  private async callOnResponse(
    req: RequestContext,
    status: number,
    startedAt: number,
    willRetry: boolean,
  ): Promise<void> {
    if (!this.cfg.onResponse) return;
    const ctx: ResponseContext = { ...req, status, durationMs: now() - startedAt, willRetry };
    await this.cfg.onResponse(ctx);
  }
}

function shouldRetryHttp(err: ScoopeError): boolean {
  return err.status === 429 || (err.status >= 500 && err.status < 600);
}

function wrapTransportError(raw: unknown): ScoopeError {
  if (raw instanceof ScoopeError) return raw;
  if (raw instanceof Error && raw.name === 'TimeoutError') return raw as TimeoutError;
  if (raw instanceof Error && (raw.name === 'AbortError' || raw.name === 'TimeoutError')) {
    return new TimeoutError(raw.message);
  }
  if (
    raw &&
    typeof raw === 'object' &&
    'name' in raw &&
    (raw as { name: string }).name === 'AbortError'
  ) {
    return new TimeoutError();
  }
  const message =
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : 'Network request failed.';
  return new NetworkError({ message, cause: raw });
}

export function computeBackoff(opts: {
  attempt: number;
  baseMs: number;
  retryAfterSeconds?: number;
  maxMs?: number;
}): number {
  const { attempt, baseMs, retryAfterSeconds } = opts;
  const max = opts.maxMs ?? 30_000;
  if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, max);
  }
  // Full-jitter exponential backoff: random in [0, base * 2^(attempt-1)].
  const window = Math.min(baseMs * 2 ** (attempt - 1), max);
  return Math.floor(Math.random() * window);
}

async function safeJson<T = unknown>(res: Response): Promise<T | undefined> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function drainBody(res: Response): Promise<void> {
  try {
    await res.text();
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function now(): number {
  // performance.now is available in all our target runtimes; Date.now is fine if not.
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// Re-export `parseRetryAfter` for tests that want to spot-check header parsing.
export { parseRetryAfter };
