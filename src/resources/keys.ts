import type { HttpClient } from '../http.js';
import type {
  ApiKey,
  ApiKeyWithSecret,
  CreateKeyRequest,
  Page,
  PageQuery,
  RotateKeyRequest,
} from '../types.js';

export class KeysResource {
  constructor(private readonly http: HttpClient) {}

  list(query: PageQuery = {}): Promise<Page<ApiKey>> {
    return this.http.request<Page<ApiKey>>({
      method: 'GET',
      path: '/v1/keys',
      query: { ...(query as Record<string, string | number | undefined>) },
    });
  }

  get(id: string): Promise<ApiKey> {
    return this.http.request<ApiKey>({
      method: 'GET',
      path: `/v1/keys/${encodeURIComponent(id)}`,
    });
  }

  create(req: CreateKeyRequest, opts: { idempotencyKey?: string } = {}): Promise<ApiKeyWithSecret> {
    const args: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path: '/v1/keys',
      body: req,
    };
    if (opts.idempotencyKey !== undefined) args.idempotencyKey = opts.idempotencyKey;
    return this.http.request<ApiKeyWithSecret>(args);
  }

  rotate(
    id: string,
    req: RotateKeyRequest = {},
    opts: { idempotencyKey?: string } = {},
  ): Promise<ApiKeyWithSecret> {
    const args: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path: `/v1/keys/${encodeURIComponent(id)}/rotate`,
      body: req,
    };
    if (opts.idempotencyKey !== undefined) args.idempotencyKey = opts.idempotencyKey;
    return this.http.request<ApiKeyWithSecret>(args);
  }

  revoke(id: string): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/v1/keys/${encodeURIComponent(id)}`,
    });
  }
}
