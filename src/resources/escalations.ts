import type { HttpClient } from '../http.js';
import type {
  Escalation,
  EscalationListQuery,
  Page,
  ResolveEscalationRequest,
} from '../types.js';
import { TimeoutError } from '../errors.js';

export interface WaitForOptions {
  /** Maximum total time to wait. Default 5 minutes. */
  timeoutMs?: number;
  /** Initial poll interval. Default 1 000 ms. */
  pollBaseMs?: number;
  /** Maximum interval between polls. Default 10 000 ms. */
  maxPollMs?: number;
  /** AbortSignal — fires `TimeoutError` if aborted. */
  signal?: AbortSignal;
}

const TERMINAL_STATUSES = new Set([
  'APPROVED',
  'DENIED',
  'TIMED_OUT',
  'NOTIFIED_FAILED',
] as const);

export class EscalationsResource {
  constructor(private readonly http: HttpClient) {}

  list(query: EscalationListQuery = {}): Promise<Page<Escalation>> {
    return this.http.request<Page<Escalation>>({
      method: 'GET',
      path: '/v1/escalations',
      query: { ...(query as Record<string, string | number | undefined>) },
    });
  }

  get(id: string): Promise<Escalation> {
    return this.http.request<Escalation>({
      method: 'GET',
      path: `/v1/escalations/${encodeURIComponent(id)}`,
    });
  }

  approve(
    id: string,
    req: ResolveEscalationRequest = {},
    opts: { idempotencyKey?: string } = {},
  ): Promise<Escalation> {
    const args: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path: `/v1/escalations/${encodeURIComponent(id)}/approve`,
      body: req,
    };
    if (opts.idempotencyKey !== undefined) args.idempotencyKey = opts.idempotencyKey;
    return this.http.request<Escalation>(args);
  }

  deny(
    id: string,
    req: ResolveEscalationRequest = {},
    opts: { idempotencyKey?: string } = {},
  ): Promise<Escalation> {
    const args: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path: `/v1/escalations/${encodeURIComponent(id)}/deny`,
      body: req,
    };
    if (opts.idempotencyKey !== undefined) args.idempotencyKey = opts.idempotencyKey;
    return this.http.request<Escalation>(args);
  }

  /**
   * Long-poll an escalation until it reaches a terminal status or the timeout
   * elapses. Disables retries on each poll so transient 5xx blips short-circuit
   * predictably; the outer loop handles backoff.
   */
  async waitFor(id: string, opts: WaitForOptions = {}): Promise<Escalation> {
    const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    const pollBase = opts.pollBaseMs ?? 1_000;
    const pollMax = opts.maxPollMs ?? 10_000;
    const startedAt = Date.now();
    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (opts.signal?.aborted) throw new TimeoutError('Escalation wait aborted.');
      if (Date.now() - startedAt > timeoutMs) {
        throw new TimeoutError(`Escalation ${id} did not resolve within ${timeoutMs}ms.`);
      }

      const requestArgs: Parameters<HttpClient['request']>[0] = {
        method: 'GET',
        path: `/v1/escalations/${encodeURIComponent(id)}`,
      };
      if (opts.signal !== undefined) requestArgs.signal = opts.signal;
      const escalation = await this.http.request<Escalation>(requestArgs);

      if (TERMINAL_STATUSES.has(escalation.status as never)) return escalation;

      attempt += 1;
      const window = Math.min(pollBase * 2 ** Math.min(attempt - 1, 6), pollMax);
      const delay = Math.floor(Math.random() * window) + Math.floor(window / 2);
      await sleep(Math.min(delay, Math.max(0, timeoutMs - (Date.now() - startedAt))));
    }
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}
