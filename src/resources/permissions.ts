import type { HttpClient } from '../http.js';
import type {
  PermissionCheckRequest,
  PermissionCheckResult,
  ToolCallResponse,
} from '../types.js';

/**
 * `permissions` is the developer-facing surface from the landing-page mockup:
 *
 * ```ts
 * const auth = await scoope.permissions.check({
 *   subject: `user_${userId}`,
 *   action: 'execute',
 *   resource: `tool:${toolName}`,
 *   context,
 * });
 * if (!auth.allowed) throw new Error(`Unauthorized: ${auth.reason}`);
 * ```
 *
 * Internally it submits a structured tool call (the gateway's policy engine
 * evaluates `tool:{name}` resources via `arg_*` conditions on `context`).
 * If the gateway exposes a dedicated `/v1/permissions/check` endpoint in a
 * future minor we will switch to it transparently.
 */
export class PermissionsResource {
  constructor(private readonly http: HttpClient) {}

  async check(req: PermissionCheckRequest): Promise<PermissionCheckResult> {
    if (!req || typeof req !== 'object') {
      throw new TypeError('permissions.check: a request object is required.');
    }
    if (!req.subject || !req.action || !req.resource) {
      throw new TypeError(
        'permissions.check: `subject`, `action`, and `resource` are all required.',
      );
    }

    const tool = stripPrefix(req.resource, 'tool:');
    const agentId = parseSubjectAgentId(req.subject);

    const response = await this.http.request<ToolCallResponse | PermissionCheckResult>({
      method: 'POST',
      path: '/v1/permissions/check',
      body: {
        subject: req.subject,
        action: req.action,
        resource: req.resource,
        context: req.context ?? {},
        // Compatibility shim: the gateway's `/v1/tools/call` accepts `tool` + `arguments`.
        // Sending both fields lets the same SDK call work whether the gateway
        // exposes the dedicated permissions endpoint or only the tool-call surface.
        tool,
        arguments: req.context ?? {},
        ...(agentId ? { agent_id: agentId } : {}),
      },
    });

    return normalizeCheckResponse(response, req);
  }
}

function stripPrefix(resource: string, prefix: string): string {
  return resource.startsWith(prefix) ? resource.slice(prefix.length) : resource;
}

function parseSubjectAgentId(subject: string): string | undefined {
  // Accept `agent_<uuid>` literally; everything else (e.g. `user_42`) is opaque.
  if (subject.startsWith('agent_')) return subject.slice('agent_'.length);
  return undefined;
}

function normalizeCheckResponse(
  raw: ToolCallResponse | PermissionCheckResult,
  req: PermissionCheckRequest,
): PermissionCheckResult {
  // If the gateway already returns the canonical permission shape, pass it through.
  if (typeof (raw as PermissionCheckResult).allowed === 'boolean') {
    return raw as PermissionCheckResult;
  }

  // Otherwise translate a `ToolCallResponse` (decision/policy_id/...).
  const t = raw as ToolCallResponse;
  const allowed = t.decision === 'allow';
  const result: PermissionCheckResult = {
    allowed,
    policy_id: t.policy_id,
    decision_id: t.id,
  };
  if (!allowed) {
    result.reason =
      t.decision === 'deny'
        ? `Policy denied ${req.action} on ${req.resource}.`
        : `Awaiting human approval for ${req.action} on ${req.resource}.`;
  }
  if (t.escalation_id) result.escalation_id = t.escalation_id;
  return result;
}
