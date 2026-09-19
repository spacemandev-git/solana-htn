import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { HTNOS_ID_ALPHABET, HTNOS_ID_LENGTH } from '@htn/shared';
import { one } from './db.ts';

function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += HTNOS_ID_ALPHABET[byte % HTNOS_ID_ALPHABET.length] ?? '2';
  return id;
}

export function mintBadgeId(db: Database): string {
  for (;;) {
    const id = randomId(HTNOS_ID_LENGTH);
    if (!one(db, 'SELECT 1 FROM devices WHERE badge_id = ?', id)) return id;
  }
}

export function mintAppId(db: Database): string {
  for (;;) {
    const id = randomId(8);
    if (!one(db, 'SELECT 1 FROM apps WHERE app_id = ?', id)) return id;
  }
}

export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length || a.length % 2 !== 0) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
