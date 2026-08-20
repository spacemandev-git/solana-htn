/**
 * Generates the raster PWA icons from the same geometry as static/icon.svg.
 *
 * Everything here is procedural — no binary assets are checked in that were not
 * produced by this script. Run with `bun run icons` after changing the mark.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

type RGB = [number, number, number];

const BG: RGB = [0x0a, 0x0a, 0x0a];
const STOPS: { at: number; rgb: RGB }[] = [
	{ at: 0, rgb: [0x99, 0x45, 0xff] },
	{ at: 0.55, rgb: [0x7a, 0x6b, 0xff] },
	{ at: 1, rgb: [0x14, 0xf1, 0x95] }
];

/** Design space matches the SVG: 512x512. */
const DESIGN = 512;
const CORNER = 112;
const GRAD_FROM = { x: 96, y: 146 };
const GRAD_TO = { x: 416, y: 364 };

/** [topY, leansRight] for the three Solana-style bars. */
const BARS: { top: number; leansRight: boolean }[] = [
	{ top: 146, leansRight: true },
	{ top: 228, leansRight: false },
	{ top: 310, leansRight: true }
];
const BAR_H = 54;
const BAR_X0 = 96;
const BAR_X1 = 380;
const BAR_SKEW = 36;

function gradientAt(x: number, y: number): RGB {
	const dx = GRAD_TO.x - GRAD_FROM.x;
	const dy = GRAD_TO.y - GRAD_FROM.y;
	const len2 = dx * dx + dy * dy;
	const t = Math.min(1, Math.max(0, ((x - GRAD_FROM.x) * dx + (y - GRAD_FROM.y) * dy) / len2));
	let lo = STOPS[0]!;
	let hi = STOPS[STOPS.length - 1]!;
	for (let i = 0; i < STOPS.length - 1; i++) {
		const a = STOPS[i]!;
		const b = STOPS[i + 1]!;
		if (t >= a.at && t <= b.at) {
			lo = a;
			hi = b;
			break;
		}
	}
	const span = hi.at - lo.at || 1;
	const k = (t - lo.at) / span;
	return [
		Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * k),
		Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * k),
		Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * k)
	];
}

function inMark(x: number, y: number): boolean {
	for (const bar of BARS) {
		if (y < bar.top || y >= bar.top + BAR_H) continue;
		const progress = (y - bar.top) / BAR_H;
		const shift = bar.leansRight ? BAR_SKEW * (1 - progress) : BAR_SKEW * progress;
		if (x >= BAR_X0 + shift && x < BAR_X1 + shift) return true;
	}
	return false;
}

function inRoundedSquare(x: number, y: number, radius: number): boolean {
	const half = DESIGN / 2;
	const dx = Math.max(Math.abs(x - half) - (half - radius), 0);
	const dy = Math.max(Math.abs(y - half) - (half - radius), 0);
	return dx * dx + dy * dy <= radius * radius;
}

interface IconOpts {
	size: number;
	/** 0 = square (full bleed), otherwise the SVG corner radius. */
	radius: number;
	/** Mark scale about the centre. Maskable icons shrink into the safe zone. */
	markScale: number;
	/** Supersampling factor for smooth edges. */
	ss?: number;
}

function renderRGBA({ size, radius, markScale, ss = 4 }: IconOpts): Uint8Array {
	const out = new Uint8Array(size * size * 4);
	const samples = ss * ss;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let sy = 0; sy < ss; sy++) {
				for (let sx = 0; sx < ss; sx++) {
					const x = ((px + (sx + 0.5) / ss) / size) * DESIGN;
					const y = ((py + (sy + 0.5) / ss) / size) * DESIGN;
					if (radius > 0 && !inRoundedSquare(x, y, radius)) continue;
					const mx = DESIGN / 2 + (x - DESIGN / 2) / markScale;
					const my = DESIGN / 2 + (y - DESIGN / 2) / markScale;
					const rgb = inMark(mx, my) ? gradientAt(mx, my) : BG;
					r += rgb[0];
					g += rgb[1];
					b += rgb[2];
					a += 255;
				}
			}
			const i = (py * size + px) * 4;
			// Premultiplied averaging would darken the edge against the alpha ramp,
			// so colours are averaged over covered samples only.
			const covered = a / 255 || 1;
			out[i] = Math.round(r / covered);
			out[i + 1] = Math.round(g / covered);
			out[i + 2] = Math.round(b / covered);
			out[i + 3] = Math.round(a / samples);
		}
	}
	return out;
}

/* ------------------------------ PNG encoding ------------------------------ */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const body = new Uint8Array(4 + data.length);
	for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
	body.set(data, 4);
	const out = new Uint8Array(8 + data.length + 4);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(body, 4);
	view.setUint32(out.length - 4, crc32(body));
	return out;
}

function encodePNG(rgba: Uint8Array, size: number): Uint8Array {
	const stride = size * 4;
	const raw = new Uint8Array((stride + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, size);
	view.setUint32(4, size);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // colour type: RGBA
	const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
	const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
	const total = parts.reduce((n, p) => n + p.length, 0);
	const png = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		png.set(part, offset);
		offset += part.length;
	}
	return png;
}

const outDir = join(import.meta.dir, '..', 'static');
const targets: (IconOpts & { file: string })[] = [
	{ file: 'icon-192.png', size: 192, radius: CORNER, markScale: 1 },
	{ file: 'icon-512.png', size: 512, radius: CORNER, markScale: 1 },
	{ file: 'icon-maskable-512.png', size: 512, radius: 0, markScale: 0.62 },
	{ file: 'apple-touch-icon.png', size: 180, radius: 0, markScale: 0.82 }
];

for (const target of targets) {
	const png = encodePNG(renderRGBA(target), target.size);
	writeFileSync(join(outDir, target.file), png);
	console.log(`wrote static/${target.file} (${target.size}px, ${png.length} bytes)`);
}
