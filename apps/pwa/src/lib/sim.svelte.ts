import { browser } from '$app/environment';

export interface SimStation {
	stationId: string;
	name: string;
}

export interface SimBadge {
	badgeId: string;
	name: string;
	email: string;
}

/** Hubs seeded for the demo — recognisable Hack the North locations. */
export const DEFAULT_STATIONS: SimStation[] = [
	{ stationId: 'e7-atrium', name: 'E7 Atrium' },
	{ stationId: 'slc-great-hall', name: 'SLC Great Hall' },
	{ stationId: 'mc-comfy', name: 'MC Comfy Lounge' },
	{ stationId: 'dc-fishbowl', name: 'DC Fishbowl' },
	{ stationId: 'e5-hardware-bay', name: 'E5 Hardware Bay' },
	{ stationId: 'midnight-ramen', name: 'Midnight Ramen Bar' }
];

export const DEFAULT_BADGES: SimBadge[] = [
	{ badgeId: 'htn-0417', name: 'Ada Nkemelu', email: 'ada.nkemelu@uwaterloo.ca' },
	{ badgeId: 'htn-0932', name: 'Rohan Mehta', email: 'rohan.mehta@mail.utoronto.ca' },
	{ badgeId: 'htn-1180', name: 'Sofia Petrova', email: 'spetrova@mcgill.ca' },
	{ badgeId: 'htn-2044', name: 'Kai Tanaka', email: 'kai.tanaka@student.ubc.ca' },
	{ badgeId: 'htn-3311', name: 'Jordan Blake', email: 'jblake@ucalgary.ca' },
	{ badgeId: 'htn-5079', name: 'Mei Lin', email: 'mei.lin@queensu.ca' }
];

const KEY = 'htn.sim.v1';

interface Snapshot {
	apiKey: string;
	stations: SimStation[];
	badges: SimBadge[];
	stationId: string;
	badgeId: string;
	autoRefresh: boolean;
	useDevRoutes: boolean;
}

/**
 * Operator console state. Everything an operator types (API key, custom
 * stations, custom badges) survives a reload, because live demos involve a lot
 * of reloads.
 */
export class SimState {
	apiKey = $state('');
	stations = $state<SimStation[]>([...DEFAULT_STATIONS]);
	badges = $state<SimBadge[]>([...DEFAULT_BADGES]);
	stationId = $state(DEFAULT_STATIONS[0]?.stationId ?? '');
	badgeId = $state(DEFAULT_BADGES[0]?.badgeId ?? '');
	autoRefresh = $state(true);
	/** Use the unauthenticated /api/dev/* handlers instead of /api/station/*. */
	useDevRoutes = $state(false);
	hydrated = $state(false);

	get station(): SimStation | null {
		return this.stations.find((s) => s.stationId === this.stationId) ?? null;
	}

	get badge(): SimBadge | null {
		return this.badges.find((b) => b.badgeId === this.badgeId) ?? null;
	}

	/** Reads persisted operator state. Safe to call only in the browser. */
	hydrate(): void {
		if (!browser) return;
		try {
			const raw = localStorage.get\u0049tem(KEY);
			if (raw) {
				const saved = JSON.parse(raw) as Partial<Snapshot>;
				if (typeof saved.apiKey === 'string') this.apiKey = saved.apiKey;
				if (Array.isArray(saved.stations) && saved.stations.length > 0)
					this.stations = saved.stations;
				if (Array.isArray(saved.badges) && saved.badges.length > 0) this.badges = saved.badges;
				if (typeof saved.stationId === 'string') this.stationId = saved.stationId;
				if (typeof saved.badgeId === 'string') this.badgeId = saved.badgeId;
				if (typeof saved.autoRefresh === 'boolean') this.autoRefresh = saved.autoRefresh;
				if (typeof saved.useDevRoutes === 'boolean') this.useDevRoutes = saved.useDevRoutes;
			}
		} catch {
			// Corrupt or blocked storage: fall back to the seeded defaults.
		}
		this.hydrated = true;
	}

	persist(): void {
		if (!browser || !this.hydrated) return;
		const snapshot: Snapshot = {
			apiKey: this.apiKey,
			stations: this.stations,
			badges: this.badges,
			stationId: this.stationId,
			badgeId: this.badgeId,
			autoRefresh: this.autoRefresh,
			useDevRoutes: this.useDevRoutes
		};
		try {
			localStorage.set\u0049tem(KEY, JSON.stringify(snapshot));
		} catch {
			// Private mode / storage full: the console still works, just not sticky.
		}
	}

	addStation(station: SimStation): void {
		this.stations = [...this.stations.filter((s) => s.stationId !== station.stationId), station];
		this.stationId = station.stationId;
	}

	addBadge(badge: SimBadge): void {
		this.badges = [...this.badges.filter((b) => b.badgeId !== badge.badgeId), badge];
		this.badgeId = badge.badgeId;
	}

	removeStation(stationId: string): void {
		if (this.stations.length <= 1) return;
		this.stations = this.stations.filter((s) => s.stationId !== stationId);
		if (this.stationId === stationId) this.stationId = this.stations[0]?.stationId ?? '';
	}

	removeBadge(badgeId: string): void {
		if (this.badges.length <= 1) return;
		this.badges = this.badges.filter((b) => b.badgeId !== badgeId);
		if (this.badgeId === badgeId) this.badgeId = this.badges[0]?.badgeId ?? '';
	}

	/** Restores the seeded stations and badges without touching the API key. */
	resetRoster(): void {
		this.stations = [...DEFAULT_STATIONS];
		this.badges = [...DEFAULT_BADGES];
		this.stationId = DEFAULT_STATIONS[0]?.stationId ?? '';
		this.badgeId = DEFAULT_BADGES[0]?.badgeId ?? '';
	}
}

export interface LogEntry {
	id: number;
	at: string;
	ok: boolean;
	title: string;
	detail: string;
}

/** Rolling operator log — the last few actions, newest first. */
export class SimLog {
	entries = $state<LogEntry[]>([]);
	#next = 1;

	push(ok: boolean, title: string, detail: string): void {
		const entry: LogEntry = {
			id: this.#next++,
			at: new Date().toLocaleTimeString([], { hour12: false }),
			ok,
			title,
			detail
		};
		this.entries = [entry, ...this.entries].slice(0, 14);
	}

	clear(): void {
		this.entries = [];
	}
}
