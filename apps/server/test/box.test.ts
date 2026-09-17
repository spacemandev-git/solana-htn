import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ALL_ITEMS,
  BOX_RESPONSE_MAX_BYTES,
  BOXES,
  REGULAR_ITEMS,
  type ApiError,
  type BadgeSummary,
  type BadgeView,
  type BoxResponse,
  type LiveEvent,
} from '@htn/shared';
import { fitBoxResponse } from '../src/services/boxes.ts';
import {
  boxBody,
  createHarness,
  json,
  questBody,
  TEST_PROGRAM_ID,
  waitForQuest,
  type Harness,
} from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

describe('blind boxes', () => {
  test('first regular tap awards one item and returns a readable badge link', async () => {
    const response = await h.box(boxBody('badge-first', 'extended-bay'));
    expect(response.status).toBe(200);
    const body = await json<BoxResponse>(response);
    expect(REGULAR_ITEMS).toContain(body.new_item as (typeof REGULAR_ITEMS)[number]);
    expect(body.all_items).toEqual([body.new_item]);

    const pairingCode = body.chain_link.split('/').at(-1)!;
    expect(body.chain_link).toBe(`http://localhost:5173/s/${pairingCode}`);
    expect(pairingCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    const view = await json<BadgeView>(await h.request(`/api/badge/${pairingCode}`));
    expect(view.badge.badgeId).toBe('badge-first');
    expect(view.awards).toHaveLength(1);
  });

  test('same box replays an identical body without another grant', async () => {
    const first = await json<BoxResponse>(await h.box(boxBody('badge-replay', 'extended-bay')));
    const second = await json<BoxResponse>(await h.box(boxBody('badge-replay', 'extended-bay')));
    expect(second).toEqual(first);
    expect(second.all_items).toHaveLength(1);
  });

  test('each box hands out its fixed item and unknown boxes are empty', async () => {
    const expected: Record<string, string> = {
      'hardware-hub': '1',
      'extended-bay': '2',
      'mentor-cafe': '3',
      'third-floor': '4',
      'fourth-floor': '5',
      'fifth-floor': '6',
      'seventh-floor': '7',
    };
    let last: BoxResponse | null = null;
    for (const [box, item] of Object.entries(expected)) {
      last = await json<BoxResponse>(await h.box(boxBody('badge-tour', box)));
      expect(last.new_item).toBe(item);
    }
    expect(last!.all_items).toEqual(['1', '2', '3', '4', '5', '6', '7']);

    const unknown = await json<BoxResponse>(await h.box(boxBody('badge-tour', 'mystery-box')));
    expect(unknown.new_item).toBe('');
    expect(unknown.all_items).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(unknown.chain_link).toBe(last!.chain_link);
  });

  test('the two Solana boxes split immediate item 8 from quest-gated item 9', async () => {
    const regular = await json<BoxResponse>(await h.box(boxBody('badge-solana', 'extended-bay')));
    const first = await json<BoxResponse>(
      await h.box(boxBody('badge-solana', 'solana-booth')),
    );
    expect(first.new_item).toBe('8');
    expect(first.all_items).toEqual([...regular.all_items, '8']);
    expect(first.chain_link).not.toBe('');

    // The first box always replays 8 without another grant.
    const again = await json<BoxResponse>(await h.box(boxBody('badge-solana', 'solana-booth')));
    expect(again).toEqual(first);

    // The final box is empty before completion and leaves inventory untouched.
    const beforeFinal = await json<BoxResponse>(
      await h.box(boxBody('badge-solana', 'solana-booth-final')),
    );
    expect(beforeFinal.new_item).toBe('');
    expect(beforeFinal.all_items).toEqual(first.all_items);

    const pairingCode = first.chain_link.split('/').at(-1)!;
    expect((await h.post('/api/quest/submit', questBody(pairingCode))).status).toBe(202);
    await waitForQuest(h, 'badge-solana');

    const after = await json<BoxResponse>(
      await h.box(boxBody('badge-solana', 'solana-booth-final')),
    );
    expect(after.new_item).toBe('9');
    expect(after.all_items.slice(-2)).toEqual(['8', '9']);
    const replay = await json<BoxResponse>(
      await h.box(boxBody('badge-solana', 'solana-booth-final')),
    );
    expect(replay.new_item).toBe('9');
    expect(replay).toEqual(after);
  });

  test('every box id yields all nine distinct items after quest completion', async () => {
    const first = await json<BoxResponse>(await h.box(boxBody('badge-tour-all', 'pairing-only')));
    const pairingCode = first.chain_link.split('/').at(-1)!;
    expect((await h.post('/api/quest/submit', questBody(pairingCode))).status).toBe(202);
    await waitForQuest(h, 'badge-tour-all');

    let last = first;
    for (const box of BOXES) {
      last = await json<BoxResponse>(await h.box(boxBody('badge-tour-all', box.id)));
      expect(last.new_item).toBe(box.item);
    }

    expect(last.all_items).toHaveLength(9);
    expect(new Set(last.all_items).size).toBe(9);
    expect([...last.all_items].sort()).toEqual([...ALL_ITEMS].sort());
  });

  test('identity falls back to public key and empty profile fields never clear data', async () => {
    const publicKeyOnly = await h.box(
      boxBody('', 'regular-key', { name: '', email: '', public_key: TEST_PROGRAM_ID }),
    );
    expect(publicKeyOnly.status).toBe(200);
    const summaries = await json<BadgeSummary[]>(await h.request('/api/badges'));
    expect(summaries[0]!.badge.badgeId).toBe(TEST_PROGRAM_ID);

    const invalid = await h.box(boxBody('', 'regular-invalid', { name: '', email: '' }));
    expect(invalid.status).toBe(400);
    expect((await json<ApiError>(invalid)).error).toBe('invalid_request');

    await h.box(boxBody('badge-profile', 'profile-1', { name: '', email: '' }));
    await h.box(
      boxBody('badge-profile', 'profile-2', { name: 'Ada Hacker', email: 'ada@example.com' }),
    );
    await h.box(boxBody('badge-profile', 'profile-3', { name: '', email: '' }));
    const updated = (await json<BadgeSummary[]>(await h.request('/api/badges'))).find(
      (summary) => summary.badge.badgeId === 'badge-profile',
    );
    expect(updated?.badge.name).toBe('Ada Hacker');
    expect(updated?.badge.email).toBe('ada@example.com');
  });

  test('nine-item response fits and oversized links are blanked', async () => {
    for (const box of BOXES) {
      if (box.id !== 'solana-booth') await h.box(boxBody('badge-size', box.id));
    }
    const summary = (await json<BadgeSummary[]>(await h.request('/api/badges')))[0]!;
    await h.post('/api/quest/submit', questBody(summary.badge.pairingCode));
    await waitForQuest(h, 'badge-size');
    await h.box(boxBody('badge-size', 'solana-booth'));
    const response = await h.box(boxBody('badge-size', 'solana-booth-final'));
    const body = await json<BoxResponse>(response);
    expect(body.all_items).toHaveLength(9);
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThanOrEqual(
      BOX_RESPONSE_MAX_BYTES,
    );
    expect(body.chain_link).not.toBe('');

    expect(
      fitBoxResponse({ new_item: '1', chain_link: 'x'.repeat(300), all_items: ['1'] }),
    ).toEqual({ new_item: '1', chain_link: '', all_items: ['1'] });
  });

  test('a tap publishes exactly one authoritative state event', async () => {
    const initial = await json<BoxResponse>(await h.box(boxBody('badge-push', 'hardware-hub')));
    const pairingCode = initial.chain_link.split('/').at(-1)!;
    const events: LiveEvent[] = [];
    const unsubscribe = h.ctx.live.subscribe(pairingCode, (event) => events.push(event));

    const tapped = await json<BoxResponse>(await h.box(boxBody('badge-push', 'extended-bay')));
    unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'state',
      view: { awards: [{ item: initial.new_item }, { item: tapped.new_item }] },
    });
  });

  test('unknown badge codes return badge_not_found', async () => {
    const response = await h.request('/api/badge/ZZZZZZ');
    expect(response.status).toBe(404);
    expect((await json<ApiError>(response)).error).toBe('badge_not_found');
  });
});
