/**
 * Public client configuration.
 *
 * Every option is optional except the API key (passed positionally to
 * `new Scoope(apiKey, opts)`). Defaults are picked to match the gateway's
 * production posture and to keep the SDK runtime-agnostic.
 */

export interface RequestContext {
  /** Resolved absolute URL the client is about to call. */
  url: string;
  method: string;
  /** Headers as a plain object. Mutating this object has no effect — they're already serialised. */
  headers: Record<string, string>;
  /** Idempotency-Key in effect for this request, if any. */
  idempotencyKey?: string;
  /** Monotonic attempt counter (1 on the first try). */
  attempt: number;
}

export interface ResponseContext extends RequestContext {
  status: number;
  durationMs: number;
  /** True if the SDK decided to retry after this response. */
  willRetry: boolean;
}

export interface ScoopeClientOptions {
  /** Override the gateway base URL. Defaults to `https://api.scoope.dev`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30s. Set to 0 to disable. */
  timeoutMs?: number;
  /** Max retry attempts for retryable failures (network, 5xx, 429). Default 3. */
  maxRetries?: number;
  /** Initial backoff in ms. Doubles each attempt with full jitter. Default 200. */
  retryBaseMs?: number;
  /** Custom `fetch` implementation — useful for testing, tracing, or odd runtimes. */
  fetch?: typeof fetch;
  /** Appended to the User-Agent header so we can identify your integration in logs. */
  userAgent?: string;
  /** Extra headers added to every outgoing request. */
  defaultHeaders?: Record<string, string>;
  /** Telemetry hook fired right before the wire send. */
  onRequest?: (ctx: RequestContext) => void | Promise<void>;
  /** Telemetry hook fired after the response is received (or the attempt fails). */
  onResponse?: (ctx: ResponseContext) => void | Promise<void>;
}

export interface ResolvedClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  fetch: typeof fetch;
  userAgent: string;
  defaultHeaders: Record<string, string>;
  onRequest?: (ctx: RequestContext) => void | Promise<void>;
  onResponse?: (ctx: ResponseContext) => void | Promise<void>;
}

const DEFAULT_BASE_URL = 'https://api.scoope.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 200;

export const SDK_VERSION = '0.1.0';

export function resolveConfig(
  apiKey: string,
  opts: ScoopeClientOptions = {},
): ResolvedClientConfig {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new TypeError(
      'Scoope: apiKey is required. Pass `new Scoope("sk_live_...")` or set it via env.',
    );
  }
  const f = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof f !== 'function') {
    throw new Error(
      'Scoope: a `fetch` implementation is required. Upgrade to Node 20+ or pass `{ fetch }`.',
    );
  }

  const ua = `scoope-sdk/${SDK_VERSION}${opts.userAgent ? ` ${opts.userAgent}` : ''}`;

  const cfg: ResolvedClientConfig = {
    apiKey,
    baseUrl: stripTrailingSlash(opts.baseUrl ?? DEFAULT_BASE_URL),
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryBaseMs: opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
    fetch: f.bind(globalThis),
    userAgent: ua,
    defaultHeaders: opts.defaultHeaders ?? {},
  };
  if (opts.onRequest) cfg.onRequest = opts.onRequest;
  if (opts.onResponse) cfg.onResponse = opts.onResponse;
  return cfg;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
