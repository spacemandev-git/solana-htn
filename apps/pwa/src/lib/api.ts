import type {
	Animal,
	Badge,
	BadgeSummary,
	BuildTxResponse,
	ClaimRequest,
	ClaimTxRequest,
	DisconnectRequest,
	Item,
	Session,
	SessionView,
	Station,
	SyncRequest,
	SyncResponse,
	Vault,
	WithdrawRequest,
	WithdrawTxRequest
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
		const message =
			(code && ERROR_COPY[code]) ?? code ?? `Request failed (${res.status}).`;
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
	session_incomplete: 'That session is missing its badge or station record.',
	badge_not_found: 'No badge with that id.',
	vault_not_found: 'That badge has no vault yet.',
	vault_not_claimed: 'Claim the vault with your wallet first.',
	vault_already_claimed: 'That vault is already claimed by a different wallet.',
	not_vault_owner: 'That vault belongs to a different wallet.',
	bad_signature: 'The wallet signature did not verify.',
	item_not_found: 'That item does not belong to this badge.',
	item_already_withdrawn: 'That item has already left escrow.',
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
	programId: string;
	badgeCount: number;
}

export function getHealth(): Promise<Health> {
	return request<Health>('/api/health');
}

/** One row of `GET /api/badges/:badgeId`'s `visits` array. */
export interface BadgeVisit {
	badgeId: string;
	stationId: string;
	stationName: string | null;
	firstSeenAt: string;
	lastSeenAt: string;
	visitCount: number;
	lastRssi: number | null;
}

/** `GET /api/badges/:badgeId` — an inline server shape, not a shared type. */
export interface BadgeDetailResponse {
	badge: Badge;
	animal: Animal;
	items: Item[];
	visits: BadgeVisit[];
	vault: Vault | null;
	sessions: Session[];
}

/** The same payload, plus the bits the dashboard derives from it. */
export interface BadgeDetail extends BadgeDetailResponse {
	activeSession: Session | null;
}

export async function getBadgeDetail(badgeId: string): Promise<BadgeDetail> {
	const raw = await request<BadgeDetailResponse>(`/api/badges/${encodeURIComponent(badgeId)}`);
	const sessions = raw.sessions ?? [];
	return {
		...raw,
		items: raw.items ?? [],
		visits: raw.visits ?? [],
		sessions,
		activeSession: sessions.find((s) => s.active) ?? null
	};
}

/* ----------------------------- writes ----------------------------- */

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

/**
 * Builds the unsigned `claim_vault` transaction. `transaction` is base64 of a
 * serialized legacy transaction, or null when the server has no chain client.
 */
export function buildClaimTx(body: ClaimTxRequest): Promise<BuildTxResponse> {
	return request<BuildTxResponse>('/api/vault/claim-tx', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

/** Builds the unsigned `withdraw_item` transaction for one item. */
export function buildWithdrawTx(body: WithdrawTxRequest): Promise<BuildTxResponse> {
	return request<BuildTxResponse>('/api/vault/withdraw-tx', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

export function claimVault(body: ClaimRequest): Promise<{ vault: Vault }> {
	return request<{ vault: Vault }>('/api/vault/claim', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

export function withdrawItem(body: WithdrawRequest): Promise<{ item: Item; wallet: string }> {
	return request<{ item: Item; wallet: string }>('/api/vault/withdraw', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

export function devReset(): Promise<unknown> {
	return request<unknown>('/api/dev/reset', { method: 'POST' });
}

/** Decodes a base64 transaction from the server into the bytes a wallet signs. */
export function decodeBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Encodes signed transaction bytes for an RPC `sendTransaction` call. */
export function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** URL of the SSE stream for a pairing code. */
export function streamUrl(pairingCode: string): string {
	return url(`/api/session/${encodeURIComponent(pairingCode)}/stream`);
}
