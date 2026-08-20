import type { Item, LiveEvent, SessionView } from '@htn/shared';
import { ApiFailure, describeError, getSession, streamUrl } from './api.ts';

export type LiveStatus =
	| 'loading'
	| 'live'
	| 'reconnecting'
	| 'wilderness'
	| 'unreachable'
	| 'missing';

/** How long a freshly unlocked item keeps its "new" treatment. */
const NEW_ITEM_MS = 9000;

/**
 * Loads a SessionView and keeps it current from the server's SSE stream.
 *
 * Owns every piece of live state the phone view renders: the view itself, the
 * connection status, the ids of items that just dropped (for the unlock
 * animation) and the most recent drop (for the banner).
 */
export class LiveSession {
	readonly pairingCode: string;

	view = $state<SessionView | null>(null);
	status = $state<LiveStatus>('loading');
	error = $state<string | null>(null);
	/** Item ids that should render their unlock animation right now. */
	freshIds = $state<number[]>([]);
	/** Newest drop, shown in the banner until dismissed or timed out. */
	latestDrop = $state<Item | null>(null);
	lastEventAt = $state<number | null>(null);

	#source: EventSource | null = null;
	#timers = new Set<ReturnType<typeof setTimeout>>();
	#stopped = false;
	#failures = 0;

	constructor(pairingCode: string) {
		this.pairingCode = pairingCode;
	}

	get isLive(): boolean {
		return this.status === 'live';
	}

	async start(): Promise<void> {
		this.#stopped = false;
		this.status = 'loading';
		this.error = null;
		try {
			const view = await getSession(this.pairingCode);
			if (this.#stopped) return;
			this.view = view;
			this.#markFresh(view.newItemIds ?? []);
			this.status = view.session.active ? 'live' : 'wilderness';
			this.#open();
		} catch (err) {
			if (this.#stopped) return;
			this.error = describeError(err);
			this.status = err instanceof ApiFailure && err.offline ? 'unreachable' : 'missing';
		}
	}

	stop(): void {
		this.#stopped = true;
		this.#source?.close();
		this.#source = null;
		for (const t of this.#timers) clearTimeout(t);
		this.#timers.clear();
	}

	dismissDrop(): void {
		this.latestDrop = null;
	}

	/** Manual retry from the error state. */
	retry(): void {
		this.stop();
		void this.start();
	}

	#open(): void {
		if (this.#stopped || this.#source) return;
		const source = new EventSource(streamUrl(this.pairingCode));
		this.#source = source;

		const handle = (raw: MessageEvent<string>) => {
			this.#failures = 0;
			this.lastEventAt = Date.now();
			let event: LiveEvent;
			try {
				event = JSON.parse(raw.data) as LiveEvent;
			} catch {
				return;
			}
			this.#apply(event);
		};

		source.onmessage = handle;
		// The server may emit named SSE events instead of unnamed ones; the payload
		// carries `type` either way, so both paths funnel into the same handler.
		for (const name of ['state', 'item', 'disconnected', 'vault-claimed', 'ping'] as const) {
			source.addEventListener(name, handle as EventListener);
		}

		source.onopen = () => {
			this.#failures = 0;
			if (this.status === 'reconnecting' || this.status === 'unreachable') {
				this.status = this.view?.session.active === false ? 'wilderness' : 'live';
			}
		};

		source.onerror = () => {
			if (this.#stopped) return;
			this.#failures += 1;
			// EventSource reconnects on its own; surface it only once we are sure.
			if (this.status !== 'wilderness') {
				this.status = this.#failures >= 3 ? 'unreachable' : 'reconnecting';
			}
			if (this.#failures >= 3 && !this.error) {
				this.error = 'Lost the live stream. Retrying…';
			}
		};
	}

	#apply(event: LiveEvent): void {
		switch (event.type) {
			case 'state': {
				this.view = event.view;
				this.#markFresh(event.view.newItemIds ?? []);
				this.status = event.view.session.active ? 'live' : 'wilderness';
				this.error = null;
				break;
			}
			case 'item': {
				this.#addItem(event.item);
				break;
			}
			case 'disconnected': {
				this.status = 'wilderness';
				const view = this.view;
				if (view) {
					this.view = {
						...view,
						session: { ...view.session, active: false, endedAt: event.at }
					};
				}
				break;
			}
			case 'vault-claimed': {
				const view = this.view;
				if (view) {
					this.view = {
						...view,
						vault: {
							...view.vault,
							ownerWallet: event.wallet,
							claimedAt: view.vault.claimedAt ?? new Date().toISOString()
						}
					};
				}
				break;
			}
			case 'ping':
				if (this.status === 'reconnecting' || this.status === 'unreachable') this.status = 'live';
				break;
		}
	}

	#addItem(item: Item): void {
		const view = this.view;
		if (!view) return;
		const exists = view.items.some((i) => i.id === item.id);
		this.view = { ...view, items: exists ? view.items.map((i) => (i.id === item.id ? item : i)) : [...view.items, item] };
		this.latestDrop = item;
		this.#markFresh([item.id]);
		this.#after(NEW_ITEM_MS, () => {
			if (this.latestDrop?.id === item.id) this.latestDrop = null;
		});
	}

	#markFresh(ids: readonly number[]): void {
		if (ids.length === 0) return;
		const merged = new Set(this.freshIds);
		for (const id of ids) merged.add(id);
		this.freshIds = [...merged];
		this.#after(NEW_ITEM_MS, () => {
			this.freshIds = this.freshIds.filter((id) => !ids.includes(id));
		});
	}

	#after(ms: number, fn: () => void): void {
		const t = setTimeout(() => {
			this.#timers.delete(t);
			if (!this.#stopped) fn();
		}, ms);
		this.#timers.add(t);
	}
}
