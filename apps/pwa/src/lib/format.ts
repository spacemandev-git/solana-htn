/** Compact "3m ago" style stamps. Returns em dash for missing timestamps. */
export function since(iso: string | null | undefined, now: number = Date.now()): string {
	if (!iso) return '—';
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return '—';
	const secs = Math.max(0, Math.round((now - then) / 1000));
	if (secs < 5) return 'just now';
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.round(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

/** Absolute URL of the phone view for a pairing code (used for QR + deep links). */
export function phoneUrl(pairingCode: string, origin?: string): string {
	const base = origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
	return `${base}/s/${encodeURIComponent(pairingCode)}`;
}
