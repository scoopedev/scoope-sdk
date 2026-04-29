import type { HttpClient } from '../http.js';
import type {
  CreatePolicyRequest,
  Page,
  PageQuery,
  Policy,
  PolicyUpdateEvent,
  UpdatePolicyRequest,
} from '../types.js';
import { NetworkError, ScoopeError } from '../errors.js';

export interface PolicySubscribeOptions {
  /** AbortSignal — close the SSE stream when this fires. */
  signal?: AbortSignal;
  /** Override the SSE endpoint path (defaults to `/v1/events/policies`). */
  path?: string;
}

export class PoliciesResource {
  constructor(private readonly http: HttpClient) {}

  list(query: PageQuery = {}): Promise<Page<Policy>> {
    return this.http.request<Page<Policy>>({
      method: 'GET',
      path: '/v1/policies',
      query: { ...(query as Record<string, string | number | undefined>) },
    });
  }

  get(id: string): Promise<Policy> {
    return this.http.request<Policy>({
      method: 'GET',
      path: `/v1/policies/${encodeURIComponent(id)}`,
    });
  }

  create(req: CreatePolicyRequest, opts: { idempotencyKey?: string } = {}): Promise<Policy> {
    const args: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path: '/v1/policies',
      body: req,
    };
    if (opts.idempotencyKey !== undefined) args.idempotencyKey = opts.idempotencyKey;
    return this.http.request<Policy>(args);
  }

  update(id: string, req: UpdatePolicyRequest): Promise<Policy> {
    return this.http.request<Policy>({
      method: 'PATCH',
      path: `/v1/policies/${encodeURIComponent(id)}`,
      body: req,
    });
  }

  publish(id: string): Promise<Policy> {
    return this.http.request<Policy>({
      method: 'POST',
      path: `/v1/policies/${encodeURIComponent(id)}/publish`,
    });
  }

  archive(id: string): Promise<Policy> {
    return this.http.request<Policy>({
      method: 'POST',
      path: `/v1/policies/${encodeURIComponent(id)}/archive`,
    });
  }

  /**
   * Async-iterable subscription to policy update events (SPEC §7-Q2 option A).
   *
   * Implemented as a `fetch` stream parser rather than the browser `EventSource`
   * so we can attach the `Authorization` header — `EventSource` cannot. Works in
   * Node 20+, Bun, Deno, and modern browsers (where `fetch` returns a streaming
   * `ReadableStream`).
   *
   * Usage:
   * ```ts
   * for await (const evt of scoope.policies.subscribe()) {
   *   console.log('policy changed', evt.policy_id, evt.event);
   * }
   * ```
   */
  subscribe(opts: PolicySubscribeOptions = {}): AsyncIterable<PolicyUpdateEvent> & {
    close: () => void;
  } {
    const http = this.http;
    const ctrl = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
      else opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal!.reason), {
        once: true,
      });
    }

    const path = opts.path ?? '/v1/events/policies';
    const url = http.buildUrl(path);

    async function* generator(): AsyncGenerator<PolicyUpdateEvent> {
      const headers: Record<string, string> = {
        ...http.authHeaders(),
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      };

      let res: Response;
      try {
        res = await (http as unknown as { cfg: { fetch: typeof fetch } }).cfg.fetch(url, {
          method: 'GET',
          headers,
          signal: ctrl.signal,
        });
      } catch (err) {
        throw new NetworkError({ message: 'Failed to open policy event stream.', cause: err });
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ScoopeError({
          status: res.status,
          code: 'sse_failed',
          message: `Could not subscribe to policy events: ${res.status} ${text || res.statusText}`,
        });
      }
      if (!res.body) {
        throw new ScoopeError({
          status: res.status,
          code: 'sse_no_body',
          message: 'Policy event stream returned no body.',
        });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = indexOfDoubleNewline(buffer)) !== -1) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, '');
            const evt = parseSseBlock(raw);
            if (evt) yield evt;
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* swallow */
        }
      }
    }

    const iterable: AsyncIterable<PolicyUpdateEvent> & { close: () => void } = {
      [Symbol.asyncIterator]: () => generator(),
      close: () => ctrl.abort(),
    };
    return iterable;
  }
}

function indexOfDoubleNewline(s: string): number {
  const i1 = s.indexOf('\n\n');
  const i2 = s.indexOf('\r\n\r\n');
  if (i1 === -1) return i2;
  if (i2 === -1) return i1;
  return Math.min(i1, i2);
}

function parseSseBlock(block: string): PolicyUpdateEvent | undefined {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
    if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return undefined;
  try {
    return JSON.parse(dataLines.join('\n')) as PolicyUpdateEvent;
  } catch {
    return undefined;
  }
}
