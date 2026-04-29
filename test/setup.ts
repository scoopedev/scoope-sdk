import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import type { RequestHandler } from 'msw';

export const BASE_URL = 'https://api.scoope.test';

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

export function use(...handlers: RequestHandler[]) {
  server.use(...handlers);
}
