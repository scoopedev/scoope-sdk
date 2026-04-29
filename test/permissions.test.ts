import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope } from '../src/index.js';
import { BASE_URL, server, use } from './setup.js';

import './setup.js';

server; // ensure setup file is bound

function client(extra: Record<string, unknown> = {}) {
  return new Scoope('sk_test_abc', { baseUrl: BASE_URL, maxRetries: 0, ...extra });
}

describe('permissions.check', () => {
  it('matches the landing-page snippet contract', async () => {
    const scoope = client();
    use(
      http.post(`${BASE_URL}/v1/permissions/check`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['subject']).toBe('user_42');
        expect(body['action']).toBe('execute');
        expect(body['resource']).toBe('tool:slack.send');
        expect(body['context']).toEqual({ channel: '#eng' });
        // Compatibility shim — gateway tool-call shape:
        expect(body['tool']).toBe('slack.send');
        expect(body['arguments']).toEqual({ channel: '#eng' });
        expect(request.headers.get('authorization')).toBe('Bearer sk_test_abc');
        expect(request.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);

        return HttpResponse.json({
          allowed: true,
          policy_id: 'pol_123',
          decision_id: 'dec_456',
        });
      }),
    );

    const auth = await scoope.permissions.check({
      subject: 'user_42',
      action: 'execute',
      resource: 'tool:slack.send',
      context: { channel: '#eng' },
    });
    expect(auth).toEqual({
      allowed: true,
      policy_id: 'pol_123',
      decision_id: 'dec_456',
    });
  });

  it('returns allowed=false with a reason when policy denies', async () => {
    const scoope = client();
    use(
      http.post(`${BASE_URL}/v1/permissions/check`, () =>
        HttpResponse.json({
          allowed: false,
          reason: 'destination not on allowlist',
          policy_id: 'pol_x',
          decision_id: 'dec_y',
        }),
      ),
    );

    const auth = await scoope.permissions.check({
      subject: 'agent_aaaa',
      action: 'execute',
      resource: 'tool:http.fetch',
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toBe('destination not on allowlist');
  });

  it('translates a tool-call response (gateway compat fallback)', async () => {
    const scoope = client();
    use(
      http.post(`${BASE_URL}/v1/permissions/check`, () =>
        HttpResponse.json({
          id: 'tc_1',
          tool: 'slack.send',
          decision: 'escalate',
          policy_id: 'pol_q',
          rule_id: 'r1',
          result: null,
          escalation_id: 'esc_99',
          latency_ms: 12,
          created_at: '2026-04-26T00:00:00Z',
        }),
      ),
    );

    const auth = await scoope.permissions.check({
      subject: 'user_1',
      action: 'execute',
      resource: 'tool:slack.send',
    });
    expect(auth.allowed).toBe(false);
    expect(auth.escalation_id).toBe('esc_99');
    expect(auth.policy_id).toBe('pol_q');
    expect(auth.decision_id).toBe('tc_1');
  });

  it('rejects malformed input synchronously', async () => {
    const scoope = client();
    await expect(
      // @ts-expect-error intentional
      scoope.permissions.check({ subject: 'u', action: 'a' }),
    ).rejects.toThrow(/required/i);
  });
});
