import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { API_KEY_HEADER } from '@htn/shared';
import { fail } from './http.ts';

/**
 * Constant-time key comparison.
 *
 * Both sides are hashed first so the comparison is always over 32 equal bytes:
 * `timingSafeEqual` throws on length mismatch, and the raw lengths would
 * otherwise leak the size of the real key.
 */
export function secretEquals(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Guards the Sync Station endpoints. Never mounted on the dev routes. */
export function stationAuth(expectedKey: string): MiddlewareHandler {
  return async (c, next) => {
    const provided = c.req.header(API_KEY_HEADER);
    if (!provided || !secretEquals(provided, expectedKey)) {
      return fail(c, 401, 'unauthorized', `missing or invalid ${API_KEY_HEADER} header`);
    }
    await next();
  };
}
