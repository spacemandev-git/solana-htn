import type { LiveEvent, QuestStep, SessionView } from '@htn/shared';
import { ApiFailure, describeError, getSession, streamUrl } from './api.ts';

export type LiveStatus =
	| 'loading'
	| 'live'
	| 'reconnecting'
	| 'wilderness'
	| 'unreachable'
	| 'missing';

export interface ProgressEntry {
	step: QuestStep;
	status: 'running' | 'ok' | 'fail';
	detail?: string;
	at: number;
}

/** Loads a SessionView and keeps quest verification current over SSE. */
export class LiveSession {
	readonly pairingCode: string;

	view = $state<SessionView | null>(null);
	status = $state<LiveStatus>('loading');
	error = $state<string | null>(null);
	progressLog = $state<ProgressEntry[]>([]);

	#source: EventSource | null = null;
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
	}

	clearLog(): void {
		this.progressLog = [];
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
			let event: LiveEvent;
			try {
				event = JSON.parse(raw.data) as LiveEvent;
			} catch {
				return;
			}
			this.#apply(event);
		};

		source.onmessage = handle;
		// Named events and unnamed events carry the same payload shape.
		for (const name of ['state', 'quest-progress', 'quest-result', 'disconnected', 'ping'] as const) {
			source.addEventListener(name, handle as EventListener);
		}

		source.onopen = () => {
			this.#failures = 0;
			this.error = null;
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
			case 'state':
				this.view = event.view;
				this.status = event.view.session.active ? 'live' : 'wilderness';
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
			case 'ping':
				if (this.status === 'reconnecting' || this.status === 'unreachable') {
					this.status = this.view?.session.active === false ? 'wilderness' : 'live';
				}
				break;
		}
	}
}
