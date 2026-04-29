import type { HttpClient } from '../http.js';
import type { UsageReport } from '../types.js';

export class UsageResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Current-period usage and plan limits for the authenticated tenant.
   * Mirrors `GET /v1/billing/usage`.
   */
  current(): Promise<UsageReport> {
    return this.http.request<UsageReport>({
      method: 'GET',
      path: '/v1/billing/usage',
    });
  }
}
