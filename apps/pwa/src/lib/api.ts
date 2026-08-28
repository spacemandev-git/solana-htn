import type {
	BadgeSummary,
	Cluster,
	DisconnectRequest,
	QuestSubmission,
	QuestSubmitRequest,
	SessionView,
	Station,
	SyncRequest,
	SyncResponse
} from '@htn/shared';
import { API_KEY_HEADER } from '@htn/shared';

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

export const SERVER_DOWN_HINT =
	'Could not reach the badge server. Start it with `bun run dev:server` (expected on http://localhost:3000).';

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
		// A 5xx with no JSON body is the dev proxy (or a crashed server) telling us
		// nothing is listening — that is an outage, not an application error.
		const dead = res.status >= 500 && parsed === null;
		if (dead) throw new ApiFailure(SERVER_DOWN_HINT, res.status, undefined, true);
		const code = typeof body?.error === 'string' ? body.error : null;
		const message = (code && ERROR_COPY[code]) ?? code ?? `Request failed (${res.status}).`;
		const detail = typeof body?.detail === 'string' ? body.detail : undefined;
		throw new ApiFailure(message, res.status, detail);
	}

	return parsed as T;
}

/** The server's `error` codes, in words a hacker standing in a hallway can act on. */
const ERROR_COPY: Record<string, string> = {
	unauthorized: 'The station API key was rejected.',
	invalid_json: 'The server could not parse that request.',
	invalid_request: 'The server rejected that request body.',
	not_found: 'That endpoint does not exist on the server.',
	session_not_found: 'No session for that pairing code.',
	session_ended: 'This pairing session has ended. Sync the badge again for a fresh code.',
	session_incomplete: 'That session is missing its badge or station record.',
	badge_not_found: 'No badge with that id.',
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

/* ----------------------------- reads ----------------------------- */

export function getSession(pairingCode: string): Promise<SessionView> {
	return request<SessionView>(`/api/session/${encodeURIComponent(pairingCode)}`);
}

export function getBadges(): Promise<BadgeSummary[]> {
	return request<BadgeSummary[]>('/api/badges');
}

export function getStations(): Promise<Station[]> {
	return request<Station[]>('/api/stations');
}

/** `GET /api/health` — liveness plus chain status. */
export interface Health {
	ok: boolean;
	chainEnabled: boolean;
	cluster: Cluster;
	payerAddress: string | null;
	maxRewardAtomic: number;
	badgeCount: number;
}

export function getHealth(): Promise<Health> {
	return request<Health>('/api/health');
}

/* ----------------------------- writes ----------------------------- */

export function submitQuest(
	body: QuestSubmitRequest
): Promise<{ submission: QuestSubmission }> {
	return request<{ submission: QuestSubmission }>('/api/quest/submit', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

/**
 * `/api/dev/sync` and `/api/dev/disconnect` are the same handlers without the
 * API key, mounted only when the server is not in production. The simulator
 * falls back to them so a demo can run before anyone finds the key.
 */
export type StationRoute = 'station' | 'dev';

export function stationSync(
	apiKey: string,
	body: SyncRequest,
	route: StationRoute = 'station'
): Promise<SyncResponse> {
	return request<SyncResponse>(route === 'dev' ? '/api/dev/sync' : '/api/station/sync', {
		method: 'POST',
		headers: route === 'dev' ? {} : { [API_KEY_HEADER]: apiKey },
		body: JSON.stringify(body)
	});
}

export interface DisconnectResponse {
	ended: boolean;
	pairingCode: string | null;
}

export function stationDisconnect(
	apiKey: string,
	body: DisconnectRequest,
	route: StationRoute = 'station'
): Promise<DisconnectResponse> {
	return request<DisconnectResponse>(
		route === 'dev' ? '/api/dev/disconnect' : '/api/station/disconnect',
		{
			method: 'POST',
			headers: route === 'dev' ? {} : { [API_KEY_HEADER]: apiKey },
			body: JSON.stringify(body)
		}
	);
}

export function devReset(): Promise<unknown> {
	return request<unknown>('/api/dev/reset', { method: 'POST' });
}

/** URL of the SSE stream for a pairing code. */
export function streamUrl(pairingCode: string): string {
	return url(`/api/session/${encodeURIComponent(pairingCode)}/stream`);
}
