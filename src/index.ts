export { Scoope } from './client.js';
export type { ScoopeClientOptions, RequestContext, ResponseContext } from './config.js';
export { SDK_VERSION } from './config.js';

export {
  ScoopeError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  RateLimitError,
  QuotaExceededError,
  ServerError,
  NotFoundError,
  ConflictError,
  NetworkError,
  TimeoutError,
} from './errors.js';

export { uuidv7 } from './uuid.js';

// Resource classes — exported so callers can spread/extend them or use the types.
export { PermissionsResource } from './resources/permissions.js';
export { ToolsResource, type ToolCallOptions } from './resources/tools.js';
export { PoliciesResource, type PolicySubscribeOptions } from './resources/policies.js';
export { KeysResource } from './resources/keys.js';
export { AuditResource } from './resources/audit.js';
export { EscalationsResource, type WaitForOptions } from './resources/escalations.js';
export { UsageResource } from './resources/usage.js';

// Wire types
export type {
  Decision,
  Scope,
  Plan,
  EscalationStatus,
  PolicyStatus,
  TimeoutAction,
  Page,
  PageQuery,
  PermissionCheckRequest,
  PermissionCheckResult,
  ToolCallRequest,
  ToolCallResponse,
  Job,
  JobAccepted,
  JobStatus,
  PolicyCondition,
  PolicyEscalationConfig,
  PolicyRule,
  PolicyDefinition,
  Policy,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  PolicyUpdateEvent,
  ApiKey,
  ApiKeyWithSecret,
  CreateKeyRequest,
  RotateKeyRequest,
  AuditEntry,
  AuditQuery,
  Escalation,
  ResolveEscalationRequest,
  EscalationListQuery,
  UsageMeter,
  UsageReport,
  ApiErrorBody,
} from './types.js';
