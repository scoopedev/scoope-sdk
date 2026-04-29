import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope, TimeoutError } from '../src/index.js';
import { BASE_URL, use } from './setup.js';

describe('tools.call async-job polling', () => {
  it('returns immediately on a synchronous tool-call response', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    use(
      http.post(`${BASE_URL}/v1/tools/call`, () =>
        HttpResponse.json({
          id: 'tc_1',
          tool: 'echo',
          decision: 'allow',
          policy_id: 'p1',
          rule_id: null,
          result: { ok: true },
          escalation_id: null,
          latency_ms: 4,
          created_at: '2026-04-26T00:00:00Z',
        }),
      ),
    );

    const res = await scoope.tools.call({ tool: 'echo', arguments: {} });
    expect(res.decision).toBe('allow');
    expect(res.result).toEqual({ ok: true });
  });

  it('polls /v1/jobs/{id} until succeeded with backoff', async () => {
    const scoope = new Scoope('sk_test', {
      baseUrl: BASE_URL,
      maxRetries: 0,
    });

    let polls = 0;
    use(
      http.post(`${BASE_URL}/v1/tools/call`, () =>
        HttpResponse.json({
          id: 'job_1',
          status: 'queued',
          created_at: '2026-04-26T00:00:00Z',
          updated_at: '2026-04-26T00:00:00Z',
        }),
      ),
      http.get(`${BASE_URL}/v1/jobs/job_1`, () => {
        polls += 1;
        if (polls < 3) {
          return HttpResponse.json({
            id: 'job_1',
            status: polls === 1 ? 'queued' : 'running',
            created_at: '2026-04-26T00:00:00Z',
            updated_at: '2026-04-26T00:00:00Z',
          });
        }
        return HttpResponse.json({
          id: 'job_1',
          status: 'succeeded',
          result: {
            id: 'tc_99',
            tool: 'long.run',
            decision: 'allow',
            policy_id: null,
            rule_id: null,
            result: { rows: 10 },
            escalation_id: null,
            latency_ms: 1100,
            created_at: '2026-04-26T00:00:01Z',
          },
          created_at: '2026-04-26T00:00:00Z',
          updated_at: '2026-04-26T00:00:01Z',
        });
      }),
    );

    const res = await scoope.tools.call(
      { tool: 'long.run', arguments: {} },
      { pollBaseMs: 1, maxPollMs: 2 },
    );
    expect(res.decision).toBe('allow');
    expect(res.result).toEqual({ rows: 10 });
    expect(polls).toBe(3);
  });

  it('throws ScoopeError on terminal job failure', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    use(
      http.post(`${BASE_URL}/v1/tools/call`, () =>
        HttpResponse.json({
          id: 'job_2',
          status: 'queued',
          created_at: '2026-04-26T00:00:00Z',
          updated_at: '2026-04-26T00:00:00Z',
        }),
      ),
      http.get(`${BASE_URL}/v1/jobs/job_2`, () =>
        HttpResponse.json({
          id: 'job_2',
          status: 'failed',
          error: { code: 'tool_failed', message: 'upstream 500' },
          created_at: '2026-04-26T00:00:00Z',
          updated_at: '2026-04-26T00:00:01Z',
        }),
      ),
    );
    await expect(
      scoope.tools.call({ tool: 'broken', arguments: {} }, { pollBaseMs: 1, maxPollMs: 2 }),
    ).rejects.toThrow(/upstream 500/);
  });

  it('respects maxWaitMs', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    use(
      http.post(`${BASE_URL}/v1/tools/call`, () =>
        HttpResponse.json({
          id: 'job_slow',
          status: 'queued',
          created_at: '2026-04-26T00:00:00Z',
          updated_at: '2026-04-26T00:00:00Z',
        }),
      ),
      http.get(`${BASE_URL}/v1/jobs/job_slow`, () =>
        HttpResponse.json({
          id: 'job_slow',
          status: 'running',
          created_at: '2026-04-26T00:00:00Z',
          updated_at: '2026-04-26T00:00:01Z',
        }),
      ),
    );
    await expect(
      scoope.tools.call(
        { tool: 'slow', arguments: {} },
        { pollBaseMs: 1, maxPollMs: 2, maxWaitMs: 25 },
      ),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
