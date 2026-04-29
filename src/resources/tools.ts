import type { HttpClient } from '../http.js';
import type { Job, ToolCallRequest, ToolCallResponse } from '../types.js';
import { ScoopeError, TimeoutError } from '../errors.js';

export interface ToolCallOptions {
  /** Override the auto-generated `Idempotency-Key`. */
  idempotencyKey?: string;
  /**
   * Async-job behaviour (SPEC §7-Q1, option B):
   *  - `auto` (default): if the gateway returns 202 + a job id, poll until terminal.
   *  - `never`:  return the raw response — caller deals with polling itself.
   *  - `always`: skip the optimistic 200 path and post directly to the async endpoint.
   */
  asyncMode?: 'auto' | 'never' | 'always';
  /** Hard cap on time spent polling. Default 120 000 ms (matches spec). */
  maxWaitMs?: number;
  /** Initial poll interval. Doubles with full jitter, capped at `maxPollMs`. Default 500. */
  pollBaseMs?: number;
  /** Cap on a single poll interval. Default 5_000. */
  maxPollMs?: number;
  /** AbortSignal — useful when an outer agent loop wants to cancel. */
  signal?: AbortSignal;
}

export class ToolsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Submit a tool call to the gateway. Returns the `ToolCallResponse` once the
   * call has reached a terminal state (allow + result, deny, or escalation
   * resolved). Async jobs are polled transparently with capped exponential
   * backoff.
   */
  async call(req: ToolCallRequest, opts: ToolCallOptions = {}): Promise<ToolCallResponse> {
    const path = opts.asyncMode === 'always' ? '/v1/tools/call?async=true' : '/v1/tools/call';

    const headers: Record<string, string> = {};
    if (opts.asyncMode === 'always') headers['Prefer'] = 'respond-async';

    const requestArgs: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path,
      body: req,
      headers,
    };
    if (opts.idempotencyKey !== undefined) requestArgs.idempotencyKey = opts.idempotencyKey;
    if (opts.signal !== undefined) requestArgs.signal = opts.signal;

    const initial = await this.http.request<ToolCallResponse | Job<ToolCallResponse>>(requestArgs);

    if (opts.asyncMode === 'never') {
      return initial as ToolCallResponse;
    }

    if (looksLikeJob(initial)) {
      return this.pollJob(initial, opts);
    }
    return initial as ToolCallResponse;
  }

  /**
   * Manually poll a job to completion. Exposed because callers who used
   * `asyncMode: 'never'` may want to opt back into the helper later.
   */
  async waitForJob<T = ToolCallResponse>(jobId: string, opts: ToolCallOptions = {}): Promise<T> {
    return this.pollJob({ id: jobId, status: 'queued' } as Job<T>, opts) as Promise<T>;
  }

  private async pollJob<T = ToolCallResponse>(job: Job<T>, opts: ToolCallOptions): Promise<T> {
    const maxWaitMs = opts.maxWaitMs ?? 120_000;
    const pollBase = opts.pollBaseMs ?? 500;
    const pollMax = opts.maxPollMs ?? 5_000;
    const startedAt = Date.now();

    let current: Job<T> = job;
    let attempt = 0;

    while (current.status === 'queued' || current.status === 'running') {
      if (opts.signal?.aborted) throw new TimeoutError('Job polling aborted.');
      if (Date.now() - startedAt > maxWaitMs) {
        throw new TimeoutError(
          `Job ${current.id} did not finish within ${maxWaitMs}ms (last status: ${current.status}).`,
        );
      }
      attempt += 1;
      const delay = Math.min(pollBase * 2 ** (attempt - 1), pollMax);
      await sleep(Math.floor(Math.random() * delay) + Math.floor(delay / 2));

      const requestArgs: Parameters<HttpClient['request']>[0] = {
        method: 'GET',
        path: `/v1/jobs/${encodeURIComponent(current.id)}`,
      };
      if (opts.signal !== undefined) requestArgs.signal = opts.signal;
      current = await this.http.request<Job<T>>(requestArgs);
    }

    if (current.status === 'succeeded') {
      if (current.result === undefined) {
        throw new ScoopeError({
          status: 0,
          code: 'malformed_job',
          message: `Job ${current.id} succeeded but produced no result.`,
        });
      }
      return current.result;
    }

    throw new ScoopeError({
      status: 0,
      code: current.error?.code ?? 'job_failed',
      message:
        current.error?.message ??
        `Job ${current.id} ended in terminal state ${current.status} without a result.`,
    });
  }
}

function looksLikeJob(value: unknown): value is Job {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.status === 'string' &&
    ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(v.status as string)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
