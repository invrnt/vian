import { expect, test } from 'bun:test';
import { safeProviderError } from './provider-error.ts';

test('provider errors never expose upstream secret content', () => {
  const secret = 'canary-provider-secret';
  for (const source of [
    Object.assign(new Error(secret), { statusCode: 401 }),
    Object.assign(new Error(secret), { statusCode: 429 }),
    Object.assign(new Error(secret), { statusCode: 502 }),
    Object.assign(new Error(secret), { statusCode: 400 }),
    new Error(secret),
  ]) expect(JSON.stringify(safeProviderError(source))).not.toContain(secret);
  expect(safeProviderError({ name: 'AbortError' }).code).toBe('cancelled');
});
