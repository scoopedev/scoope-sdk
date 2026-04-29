import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope, TimeoutError } from '../src/index.js';
import { BASE_URL, use } from './setup.js';

const baseEsc = {
  id: 'esc_1',
  tenant_id: 't_1',
  agent_id: null,
  tool_call_id: null,
  policy_id: 'p_1',
  reason: 'pending review',
  timeout_at: '2026-04-26T01:00:00Z',
  timeout_action: 'auto_deny' as const,
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
  created_at: '2026-04-26T00:00:00Z',
};

describe('escalations.waitFor', () => {
  it('resolves once status becomes terminal', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    let calls = 0;
    use(
      http.get(`${BASE_URL}/v1/escalations/esc_1`, () => {
        calls += 1;
        return HttpResponse.json({
          ...baseEsc,
          status: calls < 3 ? 'PENDING' : 'APPROVED',
          resolved_by: calls < 3 ? null : 'admin@example.com',
          resolved_at: calls < 3 ? null : '2026-04-26T00:01:00Z',
        });
      }),
    );

    const result = await scoope.escalations.waitFor('esc_1', {
      pollBaseMs: 1,
      maxPollMs: 2,
      timeoutMs: 5000,
    });
    expect(result.status).toBe('APPROVED');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('throws TimeoutError when escalation never resolves', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    use(
      http.get(`${BASE_URL}/v1/escalations/esc_1`, () =>
        HttpResponse.json({ ...baseEsc, status: 'NOTIFIED' }),
      ),
    );

    await expect(
      scoope.escalations.waitFor('esc_1', {
        pollBaseMs: 1,
        maxPollMs: 2,
        timeoutMs: 25,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('aborts cleanly via signal', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    use(
      http.get(`${BASE_URL}/v1/escalations/esc_1`, () =>
        HttpResponse.json({ ...baseEsc, status: 'PENDING' }),
      ),
    );

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 15);
    await expect(
      scoope.escalations.waitFor('esc_1', {
        pollBaseMs: 1,
        maxPollMs: 2,
        timeoutMs: 5000,
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('escalations.approve / deny', () => {
  it('POSTs note and returns updated record', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    use(
      http.post(`${BASE_URL}/v1/escalations/esc_1/approve`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['note']).toBe('looks safe');
        return HttpResponse.json({
          ...baseEsc,
          status: 'APPROVED',
          resolved_by: 'me',
          resolved_at: '2026-04-26T00:01:00Z',
          resolution_note: 'looks safe',
        });
      }),
    );
    const out = await scoope.escalations.approve('esc_1', { note: 'looks safe' });
    expect(out.status).toBe('APPROVED');
  });
});
