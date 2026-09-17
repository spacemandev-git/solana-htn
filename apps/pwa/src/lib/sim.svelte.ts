import { browser } from '$app/environment';
import { BOXES } from '@htn/shared';

export interface SimBadge {
	userId: string;
	name: string;
	email: string;
	publicKey: string;
}

export const DEFAULT_BADGES: SimBadge[] = [
	{ userId: 'htn-0417', name: 'Ada Nkemelu', email: 'ada.nkemelu@uwaterloo.ca', publicKey: '' },
	{ userId: 'htn-0932', name: 'Rohan Mehta', email: 'rohan.mehta@mail.utoronto.ca', publicKey: '' },
	{ userId: 'htn-1180', name: 'Sofia Petrova', email: 'spetrova@mcgill.ca', publicKey: '' },
	{ userId: 'htn-2044', name: 'Kai Tanaka', email: 'kai.tanaka@student.ubc.ca', publicKey: '' },
	{ userId: 'htn-3311', name: 'Jordan Blake', email: 'jblake@ucalgary.ca', publicKey: '' },
	{ userId: 'htn-5079', name: 'Mei Lin', email: 'mei.lin@queensu.ca', publicKey: '' }
];

const KEY = 'htn.sim.v2';

interface Snapshot {
	badges: SimBadge[];
	selectedBadgeId: string;
	selectedBox: string;
}

export class SimState {
	badges = $state<SimBadge[]>(DEFAULT_BADGES.map((badge) => ({ ...badge })));
	selectedBadgeId = $state(DEFAULT_BADGES[0]?.userId ?? '');
	selectedBox = $state(BOXES[0]?.id ?? '');
	hydrated = $state(false);

	get badge(): SimBadge | null {
		return this.badges.find((badge) => badge.userId === this.selectedBadgeId) ?? null;
	}

	hydrate(): void {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const saved = JSON.parse(raw) as Partial<Snapshot>;
				if (Array.isArray(saved.badges) && saved.badges.length > 0) this.badges = saved.badges;
				if (typeof saved.selectedBadgeId === 'string') {
					this.selectedBadgeId = saved.selectedBadgeId;
				}
				if (
					typeof saved.selectedBox === 'string' &&
					BOXES.some((box) => box.id === saved.selectedBox)
				) {
					this.selectedBox = saved.selectedBox;
				}
			}
		} catch {
			// Corrupt or blocked storage falls back to the seeded roster.
		}
		if (!this.badge) this.selectedBadgeId = this.badges[0]?.userId ?? '';
		this.hydrated = true;
	}

	persist(): void {
		if (!browser || !this.hydrated) return;
		const snapshot: Snapshot = {
			badges: this.badges,
			selectedBadgeId: this.selectedBadgeId,
			selectedBox: this.selectedBox
		};
		try {
			localStorage.setItem(KEY, JSON.stringify(snapshot));
		} catch {
			// Private mode or full storage leaves the tool usable without persistence.
		}
	}
}
