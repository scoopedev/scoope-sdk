import type { HttpClient } from '../http.js';
import type { AuditEntry, AuditQuery, Page } from '../types.js';

export class AuditResource {
  constructor(private readonly http: HttpClient) {}

  list(query: AuditQuery = {}): Promise<Page<AuditEntry>> {
    return this.http.request<Page<AuditEntry>>({
      method: 'GET',
      path: '/v1/audit',
      query: { ...(query as Record<string, string | number | undefined>) },
    });
  }

  /**
   * Convenience auto-paginating async iterator. Yields entries one at a time;
   * the SDK handles cursor management.
   */
  async *iterate(query: AuditQuery = {}): AsyncGenerator<AuditEntry> {
    let cursor: string | null | undefined = query.cursor;
    do {
      const page: Page<AuditEntry> = await this.list({ ...query, cursor: cursor ?? undefined });
      for (const entry of page.data) yield entry;
      cursor = page.next_cursor;
    } while (cursor);
  }
}
