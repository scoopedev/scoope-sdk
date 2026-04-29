# @scoope/sdk

Official TypeScript client for **[Scoope](https://scoope.dev)** — the policy-enforcement and observability gateway for AI agents.

```ts
import { Scoope } from '@scoope/sdk';
const scoope = new Scoope('sk_live_...');

async function executeAITool(userId, toolName, context) {
  const auth = await scoope.permissions.check({
    subject: `user_${userId}`,
    action: 'execute',
    resource: `tool:${toolName}`,
    context: context,
  });
  if (!auth.allowed) {
    throw new Error(`Unauthorized: ${auth.reason}`);
  }
  return await runTool(toolName, context);
}
```

That snippet is the contract. Drop the SDK in front of any agent runtime and Scoope will:

- evaluate per-tenant policies on every action
- emit Stripe meter events for usage
- escalate to a human (with timeout/auto-resolve) when an agent hits a boundary
- write a tamper-evident audit log

---

## Install

```sh
npm  add @scoope/sdk
pnpm add @scoope/sdk
yarn add @scoope/sdk
```

The SDK has **zero runtime dependencies**. It uses native `fetch` and runs on:

- Node.js 20+
- Bun, Deno
- Modern browsers
- Edge runtimes (Cloudflare Workers, Vercel Edge, Netlify Edge)

---

## Configure

```ts
const scoope = new Scoope('sk_live_...', {
  baseUrl: 'https://api.scoope.dev', // self-hosted? point here
  timeoutMs: 30_000,                 // per-request timeout (0 disables)
  maxRetries: 3,                     // retries 5xx + 429 with jittered backoff
  userAgent: 'my-app/1.2.3',         // appended to the SDK UA string
  fetch: globalThis.fetch,           // override (e.g. for tracing)
  onRequest: (ctx) => log.debug('scoope -> ', ctx),
  onResponse: (ctx) => log.debug('scoope <- ', ctx),
});
```

Errors are typed and instance-checked so you can branch on them safely:

```ts
import {
  ScoopeError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  QuotaExceededError,
  ValidationError,
  ServerError,
} from '@scoope/sdk';

try {
  await scoope.tools.call({ tool: 'slack.send', arguments: { ... } });
} catch (err) {
  if (err instanceof RateLimitError) wait(err.retryAfter ?? 1);
  else if (err instanceof QuotaExceededError) upgradePlan(err.meter);
  else throw err;
}
```

---

## Resources

### `permissions.check(...)` — the landing-page contract

```ts
const auth = await scoope.permissions.check({
  subject: `user_${userId}`,
  action: 'execute',
  resource: `tool:${toolName}`,
  context: { destination: 'us-east-1', amount_usd: 12.5 },
});
// => { allowed, reason?, escalation_id?, policy_id, decision_id }
```

If `allowed` is `false`, `reason` is human-readable. If a policy escalates to a human, `escalation_id` is set — pair it with `escalations.waitFor(...)` to block until a decision is made.

### `tools.call(...)` — proxy a tool call

```ts
const result = await scoope.tools.call({
  tool: 'github.create_issue',
  arguments: { repo: 'acme/web', title: 'Fix login' },
  agent_id: '7c…',
});
```

Long-running tools use the spec's async-job model (§7-Q1 option B). The SDK polls `/v1/jobs/{id}` for you, with capped exponential backoff. Tune it:

```ts
await scoope.tools.call(req, {
  asyncMode: 'auto',  // 'auto' | 'never' | 'always'
  maxWaitMs: 120_000, // hard cap on total polling
  pollBaseMs: 500,
  maxPollMs: 5_000,
  signal: ac.signal,  // cancel via AbortController
});
```

### `policies.subscribe()` — live policy updates

Hot-reload your in-process policy cache when an editor publishes a change (spec §7-Q2 option A, SSE):

```ts
const stream = scoope.policies.subscribe();
for await (const evt of stream) {
  console.log(`policy ${evt.policy_id} -> ${evt.event}`);
  refreshLocalCache(evt.policy_id);
}
// later:
stream.close();
```

(We use `fetch` streaming rather than the browser `EventSource` so the `Authorization` header attaches.)

### `keys` — issue, rotate, revoke

```ts
const k = await scoope.keys.create({
  name: 'prod-research-agent',
  scopes: ['tool:call', 'policy:read'],
  expires_at: '2026-12-31T00:00:00Z',
});
console.log('save this once:', k.secret);

const rotated = await scoope.keys.rotate(k.id, { grace_period_seconds: 86_400 });
await scoope.keys.revoke(rotated.id);
```

### `escalations` — approve / deny / wait

```ts
const escalation = await scoope.escalations.waitFor(escalationId, {
  timeoutMs: 5 * 60_000,
});

if (escalation.status === 'APPROVED') await runTool(...);
else                                   throw new Error('denied');

// from a webhook receiver:
await scoope.escalations.approve(escalationId, { note: 'reviewed by SecOps' });
```

### `audit` — query the audit log

```ts
for await (const entry of scoope.audit.iterate({ since: '2026-04-01T00:00:00Z' })) {
  console.log(entry.tool, entry.decision, entry.latency_ms);
}
```

### `usage` — current-period meters

```ts
const u = await scoope.usage.current();
console.log(`tool calls: ${u.tool_calls.used} / ${u.tool_calls.limit}`);
```

---

## Idempotency

Every mutating call (`POST`, `PATCH`, `PUT`, `DELETE`) gets an automatic UUID v7
`Idempotency-Key`. UUID v7 is time-ordered, so keys sort the same way they were
generated — handy in logs and DB indexes.

Override per call:

```ts
await scoope.keys.create(req, { idempotencyKey: 'order-2026-04-26-001' });
```

Or surface the same generator your code uses elsewhere:

```ts
import { uuidv7 } from '@scoope/sdk';
```

---

## Telemetry hooks

`onRequest` / `onResponse` fire for every wire attempt (including retries):

```ts
new Scoope(apiKey, {
  onRequest:  (c) => trace.start(`scoope.${c.method}`, { 'http.url': c.url, attempt: c.attempt }),
  onResponse: (c) => trace.end({ 'http.status_code': c.status, 'http.duration_ms': c.durationMs, retry: c.willRetry }),
});
```

---

## Versioning & types

For v0.1 the wire types are hand-written in `src/types.ts`. They mirror the
gateway's TypeBox / OpenAPI schemas one-to-one. In a future minor we will swap
in types generated by [`openapi-typescript`](https://openapi-ts.dev/) against
`${baseUrl}/openapi.json` — public exports (`PermissionCheckResult`, `Policy`,
`Escalation`, …) will remain stable.

The SDK follows semver from v1.0.0. v0.x may include breaking changes — always
pin a minor.

---

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

License: Apache-2.0
