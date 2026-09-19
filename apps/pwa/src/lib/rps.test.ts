import { describe, expect, test } from 'bun:test';
import {
	beatsSentence,
	choiceFromButton,
	lockedCommands,
	outcome,
	promptCommands,
	randomChoice,
	resultCommands,
	type Choice,
	type Outcome
} from './rps.ts';

describe('outcome', () => {
	const cases: [Choice, Choice, Outcome][] = [
		['rock', 'rock', 'draw'],
		['rock', 'paper', 'lose'],
		['rock', 'scissors', 'win'],
		['paper', 'rock', 'win'],
		['paper', 'paper', 'draw'],
		['paper', 'scissors', 'lose'],
		['scissors', 'rock', 'lose'],
		['scissors', 'paper', 'win'],
		['scissors', 'scissors', 'draw']
	];

	for (const [mine, theirs, expected] of cases) {
		test(`${mine} vs ${theirs} is ${expected}`, () => {
			expect(outcome(mine, theirs)).toBe(expected);
		});
	}
});

test('choiceFromButton maps only the three directional choices', () => {
	expect(
		['a', 'b', 'home', 'down', 'left', 'right', 'up', 'aux1', 'start'].map((button) => [
			button,
			choiceFromButton(button)
		])
	).toEqual([
		['a', null],
		['b', null],
		['home', null],
		['down', null],
		['left', 'rock'],
		['right', 'scissors'],
		['up', 'paper'],
		['aux1', null],
		['start', null]
	]);
});

test('promptCommands builds the exact prompt screen', () => {
	expect(promptCommands(3, { wins: 1, losses: 2, draws: 4 }, 'CPU') as unknown).toEqual([
		{
			cmd: 'text', id: 'prompt', text: 'ROCK PAPER\nSCISSORS', x: 8, y: 8, size: 3,
			color: '#9945ff', background: '#000000', clear: true
		},
		{
			cmd: 'text', id: 'score', text: 'Round 3   W1 L2 D4\nvs CPU', x: 8, y: 72, size: 2,
			color: '#a3a3a3', background: '#000000'
		},
		{
			cmd: 'text', id: 'keys', text: 'LEFT   rock\nUP     paper\nRIGHT  scissors', x: 8,
			y: 120, size: 2, color: '#ededed', background: '#000000'
		},
		{ cmd: 'leds', id: 'leds', body: { all: '#140a2e' } }
	]);
});

test('lockedCommands builds the exact waiting screen', () => {
	expect(lockedCommands('paper', 'xb2b9') as unknown).toEqual([
		{
			cmd: 'text', id: 'locked', text: 'YOU: PAPER', x: 8, y: 8, size: 3,
			color: '#ededed', background: '#000000', clear: true
		},
		{
			cmd: 'text', id: 'wait', text: 'waiting for\nxb2b9', x: 8, y: 72, size: 2,
			color: '#a3a3a3', background: '#000000'
		}
	]);
});

test('resultCommands builds exact win, lose, and draw screens', () => {
	expect(resultCommands('win', 'rock', 'scissors') as unknown).toEqual([
		{
			cmd: 'text', id: 'result', text: 'YOU WIN', x: 8, y: 8, size: 4,
			color: '#14f195', background: '#000000', clear: true
		},
		{
			cmd: 'text', id: 'detail', text: 'rock vs scissors\nrock beats scissors', x: 8, y: 72,
			size: 2, color: '#ededed', background: '#000000'
		},
		{ cmd: 'leds', id: 'leds', body: { all: '#14f195' } }
	]);
	expect(resultCommands('lose', 'rock', 'paper') as unknown).toEqual([
		{
			cmd: 'text', id: 'result', text: 'YOU LOSE', x: 8, y: 8, size: 4,
			color: '#ff5c5c', background: '#000000', clear: true
		},
		{
			cmd: 'text', id: 'detail', text: 'rock vs paper\npaper beats rock', x: 8, y: 72,
			size: 2, color: '#ededed', background: '#000000'
		},
		{ cmd: 'leds', id: 'leds', body: { all: '#ff5c5c' } }
	]);
	expect(resultCommands('draw', 'paper', 'paper') as unknown).toEqual([
		{
			cmd: 'text', id: 'result', text: 'DRAW', x: 8, y: 8, size: 4,
			color: '#ffb648', background: '#000000', clear: true
		},
		{
			cmd: 'text', id: 'detail', text: 'paper vs paper\nsame pick', x: 8, y: 72,
			size: 2, color: '#ededed', background: '#000000'
		},
		{ cmd: 'leds', id: 'leds', body: { all: '#ffb648' } }
	]);
	// Keep the relationship helper covered independently of result formatting.
	expect(beatsSentence('scissors', 'paper')).toBe('scissors beats paper');
});

test('randomChoice uses the supplied RNG', () => {
	expect(randomChoice(() => 0)).toBe('rock');
	expect(randomChoice(() => 0.34)).toBe('paper');
	expect(randomChoice(() => 0.99)).toBe('scissors');
});
