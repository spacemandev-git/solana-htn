import type { BadgeView, LiveEvent, QuestStep } from '@htn/shared';
import { ApiFailure, describeError, getBadge, streamUrl } from './api.ts';

export type LiveStatus = 'loading' | 'live' | 'reconnecting' | 'unreachable' | 'missing';

export interface ProgressEntry {
	step: QuestStep;
	status: 'running' | 'ok' | 'fail';
	detail?: string;
	at: number;
}

/** Loads a BadgeView and keeps inventory and quest verification current over SSE. */
export class LiveBadge {
	readonly pairingCode: string;

	view = $state<BadgeView | null>(null);
	status = $state<LiveStatus>('loading');
	error = $state<string | null>(null);
	progressLog = $state<ProgressEntry[]>([]);

	#source: EventSource | null = null;
	#stopped = false;
	#failures = 0;
	#visibilityHandler: (() => void) | null = null;
	#retryTimer: ReturnType<typeof setTimeout> | null = null;

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
			const view = await getBadge(this.pairingCode);
			if (this.#stopped) return;
			this.view = view;
			this.status = 'live';
			this.#open();
			if (typeof document !== 'undefined') {
				if (this.#visibilityHandler) {
					document.removeEventListener('visibilitychange', this.#visibilityHandler);
				}
				this.#visibilityHandler = () => {
					if (document.visibilityState === 'hidden') {
						this.#source?.close();
						this.#source = null;
						if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
						this.#retryTimer = null;
					} else if (!this.#stopped) {
						this.#open();
					}
				};
				document.addEventListener('visibilitychange', this.#visibilityHandler);
			}
		} catch (err) {
			if (this.#stopped) return;
			this.error = describeError(err);
			this.status =
				err instanceof ApiFailure && (err.offline || err.status >= 500) ? 'unreachable' : 'missing';
		}
	}

	stop(): void {
		this.#stopped = true;
		this.#source?.close();
		this.#source = null;
		if (typeof document !== 'undefined' && this.#visibilityHandler) {
			document.removeEventListener('visibilitychange', this.#visibilityHandler);
		}
		this.#visibilityHandler = null;
		if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
		this.#retryTimer = null;
	}

	clearLog(): void {
		this.progressLog = [];
	}

	/** Manual retry from an error state. */
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
			let event: LiveEvent;
			try {
				event = JSON.parse(raw.data) as LiveEvent;
			} catch {
				return;
			}
			this.#apply(event);
		};

		source.onmessage = handle;
		for (const name of ['state', 'quest-progress', 'quest-result', 'ping'] as const) {
			source.addEventListener(name, handle as EventListener);
		}

		source.onopen = () => {
			this.#failures = 0;
			this.error = null;
			this.status = 'live';
		};

		source.onerror = () => {
			if (this.#stopped) return;
			this.#failures += 1;
			this.status = this.#failures >= 3 ? 'unreachable' : 'reconnecting';
			if (this.#failures >= 3 && !this.error) this.error = 'Lost the live stream. Retrying…';
			if (source.readyState !== EventSource.CLOSED) return;
			this.#source = null;
			if (
				this.#stopped ||
				(typeof document !== 'undefined' && document.visibilityState === 'hidden')
			) {
				return;
			}
			if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
			this.#retryTimer = null;
			const delay = Math.min(30_000, 2_000 * 2 ** (this.#failures - 1));
			this.#retryTimer = setTimeout(() => {
				this.#retryTimer = null;
				this.#open();
			}, delay);
		};
	}

	#apply(event: LiveEvent): void {
		switch (event.type) {
			case 'state':
				this.view = event.view;
				this.status = 'live';
				this.error = null;
				break;
			case 'quest-progress':
				this.progressLog = [
					...this.progressLog,
					{
						step: event.step,
						status: event.status,
						...(event.detail === undefined ? {} : { detail: event.detail }),
						at: Date.now()
					}
				];
				break;
			case 'quest-result': {
				const view = this.view;
				if (view) this.view = { ...view, quest: event.submission };
				break;
			}
			case 'ping':
				if (this.status === 'reconnecting' || this.status === 'unreachable') {
					this.status = 'live';
					this.error = null;
				}
				break;
		}
	}
}
