import type { AppWsCommand } from '@htn/shared';

export type Choice = 'rock' | 'paper' | 'scissors';
export type Outcome = 'win' | 'lose' | 'draw';

export const CHOICE_BUTTONS: Record<'left' | 'up' | 'right', Choice> = {
	left: 'rock',
	up: 'paper',
	right: 'scissors'
};

const CHOICES: Choice[] = ['rock', 'paper', 'scissors'];

/** The public schema applies defaults on parse, but outbound JSON may omit defaulted fields. */
function appCommands(commands: unknown[]): AppWsCommand[] {
	return commands as AppWsCommand[];
}

export function choiceFromButton(button: string): Choice | null {
	if (button !== 'left' && button !== 'up' && button !== 'right') return null;
	return CHOICE_BUTTONS[button];
}

export function outcome(a: Choice, b: Choice): Outcome {
	if (a === b) return 'draw';
	if (
		(a === 'rock' && b === 'scissors') ||
		(a === 'scissors' && b === 'paper') ||
		(a === 'paper' && b === 'rock')
	) {
		return 'win';
	}
	return 'lose';
}

export function randomChoice(rng: () => number = Math.random): Choice {
	return CHOICES[Math.min(CHOICES.length - 1, Math.floor(rng() * CHOICES.length))] ?? 'rock';
}

export function beatsSentence(a: Choice, b: Choice): string {
	const result = outcome(a, b);
	if (result === 'draw') return '';
	return result === 'win' ? `${a} beats ${b}` : `${b} beats ${a}`;
}

export interface Score {
	wins: number;
	losses: number;
	draws: number;
}

export function promptCommands(round: number, score: Score, opponent: string): AppWsCommand[] {
	return appCommands([
		{
			cmd: 'text',
			id: 'prompt',
			text: 'ROCK PAPER\nSCISSORS',
			x: 8,
			y: 8,
			size: 3,
			color: '#9945ff',
			background: '#000000',
			clear: true
		},
		{
			cmd: 'text',
			id: 'score',
			text: `Round ${round}   W${score.wins} L${score.losses} D${score.draws}\nvs ${opponent}`,
			x: 8,
			y: 72,
			size: 2,
			color: '#a3a3a3',
			background: '#000000'
		},
		{
			cmd: 'text',
			id: 'keys',
			text: 'LEFT   rock\nUP     paper\nRIGHT  scissors',
			x: 8,
			y: 120,
			size: 2,
			color: '#ededed',
			background: '#000000'
		},
		{ cmd: 'leds', id: 'leds', body: { all: '#140a2e' } }
	]);
}

export function lockedCommands(choice: Choice, waitingFor: string): AppWsCommand[] {
	return appCommands([
		{
			cmd: 'text',
			id: 'locked',
			text: `YOU: ${choice.toUpperCase()}`,
			x: 8,
			y: 8,
			size: 3,
			color: '#ededed',
			background: '#000000',
			clear: true
		},
		{
			cmd: 'text',
			id: 'wait',
			text: `waiting for\n${waitingFor}`,
			x: 8,
			y: 72,
			size: 2,
			color: '#a3a3a3',
			background: '#000000'
		}
	]);
}

export function resultCommands(result: Outcome, mine: Choice, theirs: Choice): AppWsCommand[] {
	const color = result === 'win' ? '#14f195' : result === 'lose' ? '#ff5c5c' : '#ffb648';
	return appCommands([
		{
			cmd: 'text',
			id: 'result',
			text: result === 'win' ? 'YOU WIN' : result === 'lose' ? 'YOU LOSE' : 'DRAW',
			x: 8,
			y: 8,
			size: 4,
			color,
			background: '#000000',
			clear: true
		},
		{
			cmd: 'text',
			id: 'detail',
			text: `${mine} vs ${theirs}\n${beatsSentence(mine, theirs) || 'same pick'}`,
			x: 8,
			y: 72,
			size: 2,
			color: '#ededed',
			background: '#000000'
		},
		{ cmd: 'leds', id: 'leds', body: { all: color } }
	]);
}

export const RESULT_HOLD_MS = 2500;
