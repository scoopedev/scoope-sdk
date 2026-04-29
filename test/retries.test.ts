import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope } from '../src/index.js';
import { BASE_URL, use } from './setup.js';

describe('retry behavior', () => {
  it('retries 5xx then succeeds', async () => {
    const scoope = new Scoope('sk_test', {
      baseUrl: BASE_URL,
      maxRetries: 3,
      retryBaseMs: 1,
    });
    let calls = 0;
    use(
      http.get(`${BASE_URL}/v1/audit`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json(
            { error: 'svc', code: 'svc', message: 'down' },
            { status: 503 },
          );
        }
        return HttpResponse.json({ data: [], next_cursor: null });
      }),
    );

    const page = await scoope.audit.list();
    expect(page.data).toEqual([]);
    expect(calls).toBe(3);
  });

  it('honors Retry-After on 429', async () => {
    const scoope = new Scoope('sk_test', {
      baseUrl: BASE_URL,
      maxRetries: 1,
      retryBaseMs: 1,
    });
    const seen: number[] = [];
    use(
      http.get(`${BASE_URL}/v1/audit`, () => {
        seen.push(Date.now());
        if (seen.length === 1) {
          return HttpResponse.json(
            { error: 'rl', code: 'rl', message: 'slow' },
            { status: 429, headers: { 'Retry-After': '0' } },
          );
        }
        return HttpResponse.json({ data: [], next_cursor: null });
      }),
    );

    const page = await scoope.audit.list();
    expect(page.data).toEqual([]);
    expect(seen.length).toBe(2);
  });

  it('does not retry 4xx (other than 429)', async () => {
    const scoope = new Scoope('sk_test', {
      baseUrl: BASE_URL,
      maxRetries: 5,
      retryBaseMs: 1,
    });
    let calls = 0;
    use(
      http.get(`${BASE_URL}/v1/audit`, () => {
        calls += 1;
        return HttpResponse.json(
          { error: 'forbidden', code: 'forbidden', message: 'no' },
          { status: 403 },
        );
      }),
    );
    await expect(scoope.audit.list()).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('fires onRequest / onResponse for each attempt', async () => {
    const reqs: number[] = [];
    const resps: { status: number; willRetry: boolean }[] = [];
    const scoope = new Scoope('sk_test', {
      baseUrl: BASE_URL,
      maxRetries: 2,
      retryBaseMs: 1,
      onRequest: (ctx) => {
        reqs.push(ctx.attempt);
      },
      onResponse: (ctx) => {
        resps.push({ status: ctx.status, willRetry: ctx.willRetry });
      },
    });
    let calls = 0;
    use(
      http.get(`${BASE_URL}/v1/audit`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { error: 'svc', code: 'svc', message: 'down' },
            { status: 502 },
          );
        }
        return HttpResponse.json({ data: [], next_cursor: null });
      }),
    );

    await scoope.audit.list();
    expect(reqs).toEqual([1, 2]);
    expect(resps).toEqual([
      { status: 502, willRetry: true },
      { status: 200, willRetry: false },
    ]);
  });
});
