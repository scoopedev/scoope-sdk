import { resolveConfig, type ScoopeClientOptions, SDK_VERSION } from './config.js';
import { HttpClient } from './http.js';
import { AuditResource } from './resources/audit.js';
import { EscalationsResource } from './resources/escalations.js';
import { KeysResource } from './resources/keys.js';
import { PermissionsResource } from './resources/permissions.js';
import { PoliciesResource } from './resources/policies.js';
import { ToolsResource } from './resources/tools.js';
import { UsageResource } from './resources/usage.js';

/**
 * The Scoope client. One per API key.
 *
 * ```ts
 * import { Scoope } from '@scoope/sdk';
 * const scoope = new Scoope('sk_live_...');
 *
 * const auth = await scoope.permissions.check({
 *   subject: `user_${userId}`,
 *   action: 'execute',
 *   resource: `tool:${toolName}`,
 *   context,
 * });
 * if (!auth.allowed) throw new Error(`Unauthorized: ${auth.reason}`);
 * ```
 *
 * Sub-resources:
 *   - `permissions` — policy check / decision API (the landing-page contract)
 *   - `tools`       — submit tool calls through the gateway proxy
 *   - `policies`    — CRUD + SSE subscription on policy sets
 *   - `keys`        — issue / rotate / revoke API keys
 *   - `audit`       — read the audit log (with auto-pagination helper)
 *   - `escalations` — list, approve, deny, and `waitFor` resolution
 *   - `usage`       — current-period usage and plan limits
 */
export class Scoope {
  static readonly VERSION = SDK_VERSION;

  readonly permissions: PermissionsResource;
  readonly tools: ToolsResource;
  readonly policies: PoliciesResource;
  readonly keys: KeysResource;
  readonly audit: AuditResource;
  readonly escalations: EscalationsResource;
  readonly usage: UsageResource;

  /** @internal — exposed for advanced callers and tests; treat as unstable. */
  readonly http: HttpClient;

  constructor(apiKey: string, options: ScoopeClientOptions = {}) {
    const cfg = resolveConfig(apiKey, options);
    this.http = new HttpClient(cfg);

    this.permissions = new PermissionsResource(this.http);
    this.tools = new ToolsResource(this.http);
    this.policies = new PoliciesResource(this.http);
    this.keys = new KeysResource(this.http);
    this.audit = new AuditResource(this.http);
    this.escalations = new EscalationsResource(this.http);
    this.usage = new UsageResource(this.http);
  }
}
