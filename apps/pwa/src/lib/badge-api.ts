import type {
	AppSubmitRequest,
	HtnosApp,
	HtnosBadgeStatus,
	LedsRequest,
	TextRequest
} from '@htn/shared';

export const BADGE_API_BASE = (import.meta.env.VITE_BADGE_API_BASE ?? 'http://localhost:3100').replace(
	/\/$/,
	''
);

const ERROR_COPY: Record<string, string> = {
	bad_key: 'Wrong app key.',
	key_not_set: 'Set an app key on the badge first (Menu → App key).',
	badge_offline: 'Badge is registered but not connected.',
	badge_not_found: 'No badge with that HTN-ID.',
	badge_timeout: 'The badge did not answer in time.',
	rate_limited: 'Too many commands; slow down.',
	image_invalid: 'That file is not a PNG or JPEG.',
	image_too_large: 'Images must be under 512 KiB.'
};

export class BadgeApiFailure extends Error {
	status: number;
	code: string | null;
	detail: string | undefined;
	offline: boolean;

	constructor(
		message: string,
		status: number,
		code: string | null = null,
		detail?: string,
		offline = false
	) {
		super(message);
		this.name = 'BadgeApiFailure';
		this.status = status;
		this.code = code;
		this.detail = detail;
		this.offline = offline || status === 0;
	}
}

function url(path: string): string {
	return `${BADGE_API_BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url(path), {
			...init,
			headers: {
				Accept: 'application/json',
				...(init?.headers ?? {})
			}
		});
	} catch {
		throw new BadgeApiFailure('Could not reach the badge service.', 0, null, undefined, true);
	}

	const text = await response.text();
	let parsed: unknown = null;
	if (text.length > 0) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = null;
		}
	}

	if (!response.ok) {
		const body = parsed as { error?: unknown; detail?: unknown } | null;
		const offline = response.status >= 500 && parsed === null;
		if (offline) {
			throw new BadgeApiFailure(
				'Could not reach the badge service.',
				response.status,
				null,
				undefined,
				true
			);
		}
		const code = typeof body?.error === 'string' ? body.error : null;
		const message = (code && ERROR_COPY[code]) ?? code ?? `Request failed (${response.status}).`;
		const detail = typeof body?.detail === 'string' ? body.detail : undefined;
		throw new BadgeApiFailure(message, response.status, code, detail);
	}

	return parsed as T;
}

function jsonRequest<T>(path: string, body?: unknown, key?: string): Promise<T> {
	return request<T>(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(key === undefined ? {} : { 'X-Badge-Key': key })
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
}

export function describeBadgeError(err: unknown): string {
	if (err instanceof BadgeApiFailure) {
		return err.detail ? `${err.message} — ${err.detail}` : err.message;
	}
	if (err instanceof Error) return err.message;
	return String(err);
}

export function getBadgeHealth(): Promise<{
	ok: boolean;
	badgesRegistered: number;
	badgesOnline: number;
	apps: number;
	publicUrl: string;
}> {
	return request('/v1/health');
}

export function getBadgeStatus(badgeId: string): Promise<HtnosBadgeStatus> {
	return request(`/v1/badges/${encodeURIComponent(badgeId)}`);
}

export function badgeText(
	badgeId: string,
	key: string,
	body: Partial<TextRequest> & { text: string }
): Promise<{ ok: true }> {
	return jsonRequest(`/v1/badges/${encodeURIComponent(badgeId)}/text`, body, key);
}

export function badgeClear(
	badgeId: string,
	key: string,
	color?: string
): Promise<{ ok: true }> {
	return jsonRequest(
		`/v1/badges/${encodeURIComponent(badgeId)}/clear`,
		color === undefined ? {} : { color },
		key
	);
}

export function badgeLeds(
	badgeId: string,
	key: string,
	body: LedsRequest
): Promise<{ ok: true }> {
	return jsonRequest(`/v1/badges/${encodeURIComponent(badgeId)}/leds`, body, key);
}

export function badgeHome(badgeId: string, key: string): Promise<{ ok: true }> {
	return jsonRequest(`/v1/badges/${encodeURIComponent(badgeId)}/home`, undefined, key);
}

export function badgeImage(
	badgeId: string,
	key: string,
	file: File,
	fit: 'contain' | 'none'
): Promise<{ ok: true; width: number; height: number }> {
	return request(`/v1/badges/${encodeURIComponent(badgeId)}/image?fit=${fit}`, {
		method: 'POST',
		headers: {
			'Content-Type': file.type,
			'X-Badge-Key': key
		},
		body: file
	});
}

export function badgeEventsUrl(badgeId: string, key: string): string {
	return `${BADGE_API_BASE}/v1/badges/${encodeURIComponent(badgeId)}/events?key=${encodeURIComponent(key)}`;
}

export function badgeWsUrl(badgeId: string, key: string): string {
	const base = BADGE_API_BASE.replace(/^http(s?):/, 'ws$1:');
	return `${base}/v1/badges/${encodeURIComponent(badgeId)}/ws?key=${encodeURIComponent(key)}`;
}

export function listApps(): Promise<{ apps: HtnosApp[] }> {
	return request('/v1/apps');
}

export function submitApp(body: AppSubmitRequest): Promise<{ app: HtnosApp }> {
	return jsonRequest('/v1/apps', body);
}
