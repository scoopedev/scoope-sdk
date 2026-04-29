import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  QuotaExceededError,
  RateLimitError,
  Scoope,
  ServerError,
  ValidationError,
} from '../src/index.js';
import { BASE_URL, use } from './setup.js';

function client(extra: Record<string, unknown> = {}) {
  return new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0, ...extra });
}

const errorBody = (code: string, message: string) =>
  HttpResponse.json({ error: code, code, message }, { status: 400 });

describe('error mapping', () => {
  it('401 -> AuthenticationError', async () => {
    const s = client();
    use(
      http.post(`${BASE_URL}/v1/permissions/check`, () =>
        HttpResponse.json(
          { error: 'unauthorized', code: 'unauthorized', message: 'no key' },
          { status: 401 },
        ),
      ),
    );
    await expect(
      s.permissions.check({ subject: 'u', action: 'a', resource: 'r' }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('403 -> AuthorizationError', async () => {
    const s = client();
    use(
      http.post(`${BASE_URL}/v1/permissions/check`, () =>
        HttpResponse.json(
          { error: 'forbidden', code: 'forbidden', message: 'missing scope' },
          { status: 403 },
        ),
      ),
    );
    await expect(
      s.permissions.check({ subject: 'u', action: 'a', resource: 'r' }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('400 / 422 -> ValidationError', async () => {
    const s = client();
    use(
      http.get(`${BASE_URL}/v1/policies/p_1`, () =>
        HttpResponse.json(
          { error: 'validation_failed', code: 'validation_failed', message: 'bad uuid' },
          { status: 422 },
        ),
      ),
    );
    await expect(s.policies.get('p_1')).rejects.toBeInstanceOf(ValidationError);

    use(
      http.post(`${BASE_URL}/v1/permissions/check`, () => errorBody('bad_request', 'no')),
    );
    await expect(
      s.permissions.check({ subject: 'u', action: 'a', resource: 'r' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('404 -> NotFoundError', async () => {
    const s = client();
    use(
      http.get(`${BASE_URL}/v1/policies/missing`, () =>
        HttpResponse.json(
          { error: 'not_found', code: 'not_found', message: 'Policy not found.' },
          { status: 404 },
        ),
      ),
    );
    await expect(s.policies.get('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('409 -> ConflictError', async () => {
    const s = client();
    use(
      http.post(`${BASE_URL}/v1/keys/k_1/rotate`, () =>
        HttpResponse.json(
          { error: 'conflict', code: 'conflict', message: 'revoked' },
          { status: 409 },
        ),
      ),
    );
    await expect(s.keys.rotate('k_1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('429 with Retry-After -> RateLimitError', async () => {
    const s = client();
    use(
      http.get(`${BASE_URL}/v1/audit`, () =>
        HttpResponse.json(
          { error: 'rate_limited', code: 'rate_limited', message: 'slow down' },
          { status: 429, headers: { 'Retry-After': '7' } },
        ),
      ),
    );
    try {
      await s.audit.list();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(7);
    }
  });

  it('429 with X-Quota-Exceeded -> QuotaExceededError', async () => {
    const s = client();
    use(
      http.get(`${BASE_URL}/v1/audit`, () =>
        HttpResponse.json(
          {
            error: 'quota_exceeded',
            code: 'quota_exceeded',
            message: 'plan cap',
            details: { meter: 'tool_calls' },
          },
          { status: 429, headers: { 'X-Quota-Exceeded': 'tool_calls' } },
        ),
      ),
    );
    try {
      await s.audit.list();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      expect((err as QuotaExceededError).meter).toBe('tool_calls');
    }
  });

  it('5xx -> ServerError after retries exhausted', async () => {
    const s = client({ maxRetries: 1, retryBaseMs: 1 });
    let calls = 0;
    use(
      http.get(`${BASE_URL}/v1/audit`, () => {
        calls++;
        return HttpResponse.json(
          { error: 'internal', code: 'internal', message: 'boom' },
          { status: 500 },
        );
      }),
    );
    await expect(s.audit.list()).rejects.toBeInstanceOf(ServerError);
    expect(calls).toBe(2); // initial + 1 retry
  });
});
