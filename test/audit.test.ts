import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Scoope } from '../src/index.js';
import { BASE_URL, use } from './setup.js';

const entry = (id: string) => ({
  id,
  tenant_id: 't1',
  timestamp: '2026-04-26T00:00:00Z',
  agent_id: null,
  tool: 'slack.send',
  action: 'tool.call',
  decision: 'allow' as const,
  latency_ms: 4,
  metadata: {},
});

describe('audit', () => {
  it('paginates via .iterate()', async () => {
    const scoope = new Scoope('sk_test', { baseUrl: BASE_URL, maxRetries: 0 });

    let hit = 0;
    use(
      http.get(`${BASE_URL}/v1/audit`, ({ request }) => {
        hit += 1;
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        if (!cursor) {
          return HttpResponse.json({ data: [entry('a1'), entry('a2')], next_cursor: 'cur1' });
        }
        return HttpResponse.json({ data: [entry('a3')], next_cursor: null });
      }),
    );

    const ids: string[] = [];
    for await (const e of scoope.audit.iterate({ limit: 50 })) ids.push(e.id);
    expect(ids).toEqual(['a1', 'a2', 'a3']);
    expect(hit).toBe(2);
  });
});
