import { describe, expect, test } from 'bun:test';
import { QUEST_MESSAGE_MAX, QUEST_MESSAGE_OFFSET } from '@htn/shared';

import { decodeQuestAccount } from '../src/live.ts';

function accountWith(bytes: Uint8Array, declaredLength = bytes.length): Uint8Array {
  const data = new Uint8Array(QUEST_MESSAGE_OFFSET + 4 + bytes.length);
  new DataView(data.buffer).setUint32(QUEST_MESSAGE_OFFSET, declaredLength, true);
  data.set(bytes, QUEST_MESSAGE_OFFSET + 4);
  return data;
}

describe('quest account decoding', () => {
  test('reads the u32 at offset 40 and content at offset 44', () => {
    const data = accountWith(new TextEncoder().encode('hello'));
    data[39] = 255;
    expect(decodeQuestAccount(data)).toBe('hello');
  });

  test('accepts the exact maximum byte length', () => {
    expect(decodeQuestAccount(accountWith(new Uint8Array(QUEST_MESSAGE_MAX).fill(97)))).toBe(
      'a'.repeat(QUEST_MESSAGE_MAX),
    );
  });

  test('rejects lengths above the maximum', () => {
    expect(() => decodeQuestAccount(accountWith(new Uint8Array(), QUEST_MESSAGE_MAX + 1))).toThrow(
      /exceeds 256/,
    );
  });

  test('rejects a truncated message', () => {
    expect(() => decodeQuestAccount(accountWith(new Uint8Array([97]), 2))).toThrow(
      /ends at byte 46, account has 45 bytes/,
    );
  });

  test('rejects malformed UTF-8', () => {
    expect(() => decodeQuestAccount(accountWith(new Uint8Array([0xc3, 0x28])))).toThrow();
  });

  test('decodes Unicode by byte length', () => {
    const message = 'quest 🧭';
    expect(decodeQuestAccount(accountWith(new TextEncoder().encode(message)))).toBe(message);
  });
});
