import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope, uuidv7 } from '../src/index.js';
import { BASE_URL, use } from './setup.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('Idempotency-Key handling', () => {
  it('auto-generates a UUID v7 for mutating calls', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    let captured: string | null = null;
    use(
      http.post(`${BASE_URL}/v1/keys`, ({ request }) => {
        captured = request.headers.get('idempotency-key');
        return HttpResponse.json(
          {
            id: 'k1',
            name: 'x',
            prefix: 'sk_',
            tenant_id: 't1',
            scopes: ['tool:call'],
            agent_id: null,
            expires_at: null,
            last_used_at: null,
            revoked_at: null,
            created_by: 'me',
            created_at: '2026-04-26T00:00:00Z',
            secret: 'sk_live_abcdef',
          },
          { status: 201 },
        );
      }),
    );

    await scoope.keys.create({ name: 'x', scopes: ['tool:call'] });
    expect(captured).not.toBeNull();
    expect(captured!).toMatch(UUID_RE);
  });

  it('passes through caller-supplied keys verbatim', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    let seen: string | null = null;
    use(
      http.post(`${BASE_URL}/v1/keys`, ({ request }) => {
        seen = request.headers.get('idempotency-key');
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    await scoope.keys.create(
      { name: 'x', scopes: ['tool:call'] },
      { idempotencyKey: 'idemp-fixed-1' },
    );
    expect(seen).toBe('idemp-fixed-1');
  });

  it('does not send Idempotency-Key on GET', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    let seen: string | null = '__sentinel__';
    use(
      http.get(`${BASE_URL}/v1/audit`, ({ request }) => {
        seen = request.headers.get('idempotency-key');
        return HttpResponse.json({ data: [], next_cursor: null });
      }),
    );
    await scoope.audit.list();
    expect(seen).toBeNull();
  });

  it('uuidv7() is exported and well-formed', () => {
    for (let i = 0; i < 16; i++) {
      const id = uuidv7();
      expect(id).toMatch(UUID_RE);
    }
  });
});
