import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope } from '../src/index.js';
import { BASE_URL, use } from './setup.js';

describe('policies.subscribe (SSE)', () => {
  it('parses event blocks into PolicyUpdateEvent', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });

    use(
      http.get(`${BASE_URL}/v1/events/policies`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer sk_test');
        const body =
          ': connected\n\n' +
          'event: policy.updated\n' +
          'data: ' +
          JSON.stringify({
            event: 'updated',
            policy_id: 'p_1',
            tenant_id: 't_1',
            version: 7,
            at: '2026-04-26T00:00:00Z',
          }) +
          '\n\n' +
          'event: policy.published\n' +
          'data: ' +
          JSON.stringify({
            event: 'published',
            policy_id: 'p_2',
            tenant_id: 't_1',
            at: '2026-04-26T00:00:01Z',
          }) +
          '\n\n';
        return new HttpResponse(body, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const stream = scoope.policies.subscribe();
    const events: string[] = [];
    for await (const evt of stream) {
      events.push(evt.event + ':' + evt.policy_id);
    }
    expect(events).toEqual(['updated:p_1', 'published:p_2']);
  });

  it('close() aborts an in-flight stream', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    use(
      http.get(`${BASE_URL}/v1/events/policies`, async () => {
        // Hang forever (until aborted) — that's exactly what production SSE does.
        await new Promise(() => {});
        return new HttpResponse('', { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );

    const stream = scoope.policies.subscribe();
    setTimeout(() => stream.close(), 25);
    const events: string[] = [];
    await expect(
      (async () => {
        for await (const evt of stream) events.push(evt.event);
      })(),
    ).rejects.toThrow();
    expect(events).toEqual([]);
  });

  it('throws ScoopeError when the gateway responds non-2xx', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });

    use(
      http.get(`${BASE_URL}/v1/events/policies`, () =>
        HttpResponse.json(
          { error: 'forbidden', code: 'forbidden', message: 'no scope' },
          { status: 403 },
        ),
      ),
    );

    const stream = scoope.policies.subscribe();
    await expect(
      (async () => {
        for await (const _ of stream) {
          /* unreachable */
          break;
        }
      })(),
    ).rejects.toThrow(/Could not subscribe/);
  });
});
