import type { AppWsCommand, AppWsMessage } from '@htn/shared';
import { badgeWsUrl } from './badge-api.ts';
import {
	choiceFromButton,
	lockedCommands,
	outcome,
	promptCommands,
	randomChoice,
	resultCommands,
	RESULT_HOLD_MS,
	type Choice,
	type Outcome,
	type Score
} from './rps.ts';

export type Phase = 'idle' | 'connecting' | 'prompt' | 'resolving' | 'result' | 'error';

export interface PlayerSlot {
	badgeId: string;
	key: string;
	choice: Choice | null;
	connected: boolean;
	label: string;
}

const ERROR_COPY: Record<string, string> = {
	badge_offline: 'Badge is registered but not connected.',
	key_not_set: 'Set an app key on the badge first (Menu → App key).',
	bad_key: 'Wrong app key.',
	rate_limited: 'Too many commands; slow down.'
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseMessage(data: unknown): AppWsMessage | null {
	if (typeof data !== 'string') return null;
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}
	if (!isRecord(value) || typeof value.type !== 'string') return null;
	if (value.type === 'reply') {
		if (!('data' in value)) return null;
		return {
			type: 'reply',
			id: typeof value.id === 'string' ? value.id : null,
			data: value.data
		};
	}
	if (value.type === 'error') {
		if (typeof value.error !== 'string') return null;
		return {
			type: 'error',
			id: typeof value.id === 'string' ? value.id : null,
			error: value.error,
			...(typeof value.detail === 'string' ? { detail: value.detail } : {})
		};
	}
	if (value.type !== 'event' || !isRecord(value.data) || typeof value.data.event !== 'string') {
		return null;
	}
	return value as AppWsMessage;
}

export class RpsGame {
	phase = $state<Phase>('idle');
	round = $state(1);
	score = $state<Score>({ wins: 0, losses: 0, draws: 0 });
	players = $state<PlayerSlot[]>([]);
	lastResult = $state<{ outcome: Outcome; mine: Choice; theirs: Choice } | null>(null);
	error = $state<string | null>(null);
	log = $state<string[]>([]);

	#sockets: WebSocket[] = [];
	#resultTimer: ReturnType<typeof setTimeout> | null = null;
	#generation = 0;

	start(
		p1: { badgeId: string; key: string },
		p2?: { badgeId: string; key: string }
	): void {
		this.#discardConnections();
		const generation = ++this.#generation;
		this.phase = 'connecting';
		this.round = 1;
		this.score = { wins: 0, losses: 0, draws: 0 };
		this.lastResult = null;
		this.error = null;
		this.log = [];
		this.players = [
			{ badgeId: p1.badgeId, key: p1.key, choice: null, connected: false, label: 'You' },
			...(p2
				? [
						{
							badgeId: p2.badgeId,
							key: p2.key,
							choice: null,
							connected: false,
							label: 'Opponent'
						}
					]
				: [])
		];

		for (const [index, player] of this.players.entries()) {
			const socket = new WebSocket(badgeWsUrl(player.badgeId, player.key));
			this.#sockets[index] = socket;
			this.#append(`↗ ${player.badgeId} connecting`);

			socket.onopen = () => {
				if (generation !== this.#generation) return;
				const current = this.players[index];
				if (!current) return;
				current.connected = true;
				this.#append(`← ${current.badgeId} connected`);
				if (this.phase === 'connecting' && this.players.every((slot) => slot.connected)) {
					this.#sendPrompts();
					this.phase = 'prompt';
				}
			};

			socket.onmessage = (event: MessageEvent<unknown>) => {
				if (generation !== this.#generation) return;
				const message = parseMessage(event.data);
				if (!message) {
					this.#append(`← ${player.badgeId} unreadable message`);
					return;
				}
				this.#receive(index, message);
			};

			socket.onerror = () => {
				if (generation === this.#generation) this.#append(`← ${player.badgeId} socket error`);
			};

			socket.onclose = (event: CloseEvent) => {
				if (generation !== this.#generation) return;
				const current = this.players[index];
				if (current) current.connected = false;
				this.#append(`← ${player.badgeId} closed ${event.code}`);
				this.#fail(
					event.code === 4403
						? 'Wrong or missing app key.'
						: event.code === 4404
							? 'No badge with that HTN-ID.'
							: 'Connection to the badge service dropped.'
				);
			};
		}
	}

	stop(): void {
		++this.#generation;
		this.#clearResultTimer();
		for (const [index, socket] of this.#sockets.entries()) {
			const player = this.players[index];
			if (player && socket.readyState === WebSocket.OPEN) {
				const command: AppWsCommand = { cmd: 'home' };
				try {
					socket.send(JSON.stringify(command));
					this.#append(`→ ${player.badgeId} home`);
				} catch {
					this.#append(`→ ${player.badgeId} home failed`);
				}
			}
			socket.close();
		}
		this.#sockets = [];
		for (const player of this.players) player.connected = false;
		this.phase = 'idle';
	}

	#receive(index: number, message: AppWsMessage): void {
		const player = this.players[index];
		if (!player) return;
		if (message.type === 'reply') {
			this.#append(`← ${player.badgeId} reply ${message.id ?? 'command'}`);
			return;
		}
		if (message.type === 'error') {
			this.#append(`← ${player.badgeId} error ${message.error}`);
			this.#fail(ERROR_COPY[message.error] ?? message.detail ?? message.error);
			return;
		}

		const event = message.data;
		if (event.event === 'button') {
			this.#append(
				`← ${player.badgeId} button ${event.button} ${event.pressed ? 'pressed' : 'released'}`
			);
			if (!event.pressed || this.phase !== 'prompt' || player.choice !== null) return;
			const choice = choiceFromButton(event.button);
			if (!choice) return;
			player.choice = choice;
			const waitingFor = this.players.length === 1 ? 'CPU' : (this.players[1 - index]?.badgeId ?? 'opponent');
			this.#send(index, lockedCommands(choice, waitingFor));
			if (this.players.length === 1) this.#resolve(randomChoice());
			else if (this.players.every((slot) => slot.choice !== null)) this.#resolve();
			return;
		}
		if (event.event === 'mode') {
			this.#append(`← ${player.badgeId} mode ${event.mode}`);
			return;
		}
		this.#append(`← ${player.badgeId} ${event.event}`);
	}

	#resolve(cpuChoice?: Choice): void {
		const playerOne = this.players[0];
		const mine = playerOne?.choice;
		const theirs = this.players.length === 1 ? cpuChoice : this.players[1]?.choice;
		if (!playerOne || !mine || !theirs) return;

		this.phase = 'resolving';
		const result = outcome(mine, theirs);
		this.#send(0, resultCommands(result, mine, theirs));
		if (this.players.length === 2) {
			this.#send(1, resultCommands(outcome(theirs, mine), theirs, mine));
		}
		this.score = {
			wins: this.score.wins + (result === 'win' ? 1 : 0),
			losses: this.score.losses + (result === 'lose' ? 1 : 0),
			draws: this.score.draws + (result === 'draw' ? 1 : 0)
		};
		this.lastResult = { outcome: result, mine, theirs };
		this.phase = 'result';

		const generation = this.#generation;
		this.#resultTimer = setTimeout(() => {
			this.#resultTimer = null;
			if (generation !== this.#generation || this.phase !== 'result') return;
			this.round += 1;
			for (const player of this.players) player.choice = null;
			this.#sendPrompts();
			this.phase = 'prompt';
		}, RESULT_HOLD_MS);
	}

	#sendPrompts(): void {
		for (const [index] of this.players.entries()) {
			const opponent = this.players.length === 1 ? 'CPU' : (this.players[1 - index]?.badgeId ?? 'opponent');
			this.#send(index, promptCommands(this.round, this.score, opponent));
		}
	}

	#send(index: number, commands: AppWsCommand[]): void {
		const socket = this.#sockets[index];
		const player = this.players[index];
		if (!socket || !player || socket.readyState !== WebSocket.OPEN) return;
		for (const command of commands) {
			try {
				socket.send(JSON.stringify(command));
				this.#append(`→ ${player.badgeId} ${command.cmd}${command.id ? ` ${command.id}` : ''}`);
			} catch {
				this.#fail('Connection to the badge service dropped.');
				return;
			}
		}
	}

	#fail(message: string): void {
		this.#clearResultTimer();
		this.error = message;
		this.phase = 'error';
	}

	#append(line: string): void {
		this.log = [...this.log, line].slice(-50);
	}

	#clearResultTimer(): void {
		if (this.#resultTimer !== null) clearTimeout(this.#resultTimer);
		this.#resultTimer = null;
	}

	#discardConnections(): void {
		this.#clearResultTimer();
		++this.#generation;
		for (const socket of this.#sockets) socket.close();
		this.#sockets = [];
	}
}
