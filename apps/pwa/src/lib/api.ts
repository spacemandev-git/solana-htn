import type {
	BadgeSummary,
	BadgeView,
	BoxRequest,
	BoxResponse,
	Cluster,
	QuestSubmission,
	QuestSubmitRequest
} from '@htn/shared';

/**
 * Base for API calls. Empty in dev — vite proxies /api to the server on :3000,
 * so there is never a CORS preflight. Set VITE_API_BASE when the PWA is served
 * from a different origin than the API.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** Any non-2xx response, or the server being unreachable at all. */
export class ApiFailure extends Error {
	readonly status: number;
	readonly detail: string | undefined;
	/** True when the API never answered: connection refused, or a proxy 5xx. */
	readonly offline: boolean;

	constructor(message: string, status: number, detail?: string, offline = false) {
		super(message);
		this.name = 'ApiFailure';
		this.status = status;
		this.detail = detail;
		this.offline = offline || status === 0;
	}
}

export const SERVER_DOWN_HINT = import.meta.env.DEV
	? 'Could not reach the badge server. Start it with `bun run dev:server` (expected on http://localhost:3000).'
	: 'Could not reach the badge server. Check your connection and retry.';

function url(path: string): string {
	return `${API_BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(url(path), {
			...init,
			headers: {
				Accept: 'application/json',
				...(init?.body ? { 'Content-Type': 'application/json' } : {}),
				...(init?.headers ?? {})
			}
		});
	} catch {
		throw new ApiFailure(SERVER_DOWN_HINT, 0);
	}

	const text = await res.text();
	let parsed: unknown = null;
	if (text.length > 0) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = null;
		}
	}

	if (!res.ok) {
		const body = parsed as { error?: unknown; detail?: unknown } | null;
		const dead = res.status >= 500 && parsed === null;
		if (dead) throw new ApiFailure(SERVER_DOWN_HINT, res.status, undefined, true);
		const code = typeof body?.error === 'string' ? body.error : null;
		const message = (code && ERROR_COPY[code]) ?? code ?? `Request failed (${res.status}).`;
		const detail = typeof body?.detail === 'string' ? body.detail : undefined;
		throw new ApiFailure(message, res.status, detail);
	}

	return parsed as T;
}

/** The server's error codes, in words an attendee can act on. */
export const ERROR_COPY: Record<string, string> = {
	invalid_json: 'The server could not parse that request.',
	invalid_request: 'The server rejected that request body.',
	not_found: 'That endpoint does not exist on the server.',
	badge_not_found: 'No badge with that pairing code. Tap a box with your badge first.',
	quest_verifying: 'This quest is already being verified.',
	quest_already_completed: 'This quest is already complete.',
	quest_already_paid: 'The agent already paid this badge and cannot pay it twice.',
	internal_error: 'The server hit an unexpected error.'
};

/** Human-readable message for anything thrown out of this module. */
export function describeError(err: unknown): string {
	if (err instanceof ApiFailure) return err.detail ? `${err.message} — ${err.detail}` : err.message;
	if (err instanceof Error) return err.message;
	return String(err);
}

export function getBadge(pairingCode: string): Promise<BadgeView> {
	return request<BadgeView>(`/api/badge/${encodeURIComponent(pairingCode)}`);
}

export function getBadges(): Promise<BadgeSummary[]> {
	return request<BadgeSummary[]>('/api/badges');
}

export interface Health {
	ok: boolean;
	chainEnabled: boolean;
	cluster: Cluster;
	payerAddress: string | null;
	maxRewardAtomic: number;
	badgeCount: number;
	solanaBoxId: string;
}

export function getHealth(): Promise<Health> {
	return request<Health>('/api/health');
}

export function submitQuest(
	body: QuestSubmitRequest
): Promise<{ submission: QuestSubmission }> {
	return request<{ submission: QuestSubmission }>('/api/quest/submit', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

export function tapBox(body: BoxRequest): Promise<BoxResponse> {
	return request<BoxResponse>('/api/box', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

export function devReset(): Promise<{ ok: true; reset: true }> {
	return request<{ ok: true; reset: true }>('/api/dev/reset', { method: 'POST' });
}

/** URL of the SSE stream for a pairing code. */
export function streamUrl(pairingCode: string): string {
	return url(`/api/badge/${encodeURIComponent(pairingCode)}/stream`);
}
