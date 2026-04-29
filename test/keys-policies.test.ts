import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope } from '../src/index.js';
import { BASE_URL, use } from './setup.js';

describe('keys + policies CRUD', () => {
  it('issues, lists, rotates, revokes', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });

    use(
      http.post(`${BASE_URL}/v1/keys`, () =>
        HttpResponse.json(
          {
            id: 'k1',
            name: 'agent',
            prefix: 'sk_live_a',
            tenant_id: 't1',
            scopes: ['tool:call'],
            agent_id: null,
            expires_at: null,
            last_used_at: null,
            revoked_at: null,
            created_by: 'me',
            created_at: '2026-04-26T00:00:00Z',
            secret: 'sk_live_aaaaaaaa',
          },
          { status: 201 },
        ),
      ),
      http.get(`${BASE_URL}/v1/keys`, () =>
        HttpResponse.json({
          data: [
            {
              id: 'k1',
              name: 'agent',
              prefix: 'sk_live_a',
              tenant_id: 't1',
              scopes: ['tool:call'],
              agent_id: null,
              expires_at: null,
              last_used_at: null,
              revoked_at: null,
              created_by: 'me',
              created_at: '2026-04-26T00:00:00Z',
            },
          ],
          next_cursor: null,
        }),
      ),
      http.post(`${BASE_URL}/v1/keys/k1/rotate`, () =>
        HttpResponse.json(
          {
            id: 'k2',
            name: 'agent',
            prefix: 'sk_live_b',
            tenant_id: 't1',
            scopes: ['tool:call'],
            agent_id: null,
            expires_at: null,
            last_used_at: null,
            revoked_at: null,
            created_by: 'me',
            created_at: '2026-04-26T00:01:00Z',
            secret: 'sk_live_bbbbbbbb',
          },
          { status: 201 },
        ),
      ),
      http.delete(`${BASE_URL}/v1/keys/k2`, () => new HttpResponse(null, { status: 204 })),
    );

    const created = await scoope.keys.create({ name: 'agent', scopes: ['tool:call'] });
    expect(created.secret).toBe('sk_live_aaaaaaaa');

    const list = await scoope.keys.list({ limit: 10 });
    expect(list.data.length).toBe(1);

    const rotated = await scoope.keys.rotate('k1', { grace_period_seconds: 3600 });
    expect(rotated.secret).toBe('sk_live_bbbbbbbb');

    const revoked = await scoope.keys.revoke('k2');
    expect(revoked).toBeUndefined();
  });

  it('creates and publishes a policy', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });
    const policy = {
      id: 'p1',
      tenant_id: 't1',
      name: 'allow slack only',
      version: 1,
      status: 'draft' as const,
      definition: { rules: [{ when: { op: 'always' as const }, then: { decision: 'allow' as const } }] },
      created_at: '2026-04-26T00:00:00Z',
      updated_at: '2026-04-26T00:00:00Z',
    };
    use(
      http.post(`${BASE_URL}/v1/policies`, () => HttpResponse.json(policy, { status: 201 })),
      http.post(`${BASE_URL}/v1/policies/p1/publish`, () =>
        HttpResponse.json({ ...policy, status: 'published' as const, version: 2 }),
      ),
    );

    const created = await scoope.policies.create({
      name: policy.name,
      definition: policy.definition,
    });
    expect(created.status).toBe('draft');

    const published = await scoope.policies.publish('p1');
    expect(published.status).toBe('published');
  });
});
