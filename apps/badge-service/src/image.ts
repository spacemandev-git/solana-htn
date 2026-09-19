import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import {
  HTNOS_BLIT_ROWS,
  HTNOS_SCREEN_HEIGHT,
  HTNOS_SCREEN_WIDTH,
  rgb565,
} from '@htn/shared';

export class ImageError extends Error {
  readonly code: 'image_invalid' | 'image_too_large';

  constructor(code: 'image_invalid' | 'image_too_large') {
    super(code);
    this.name = 'ImageError';
    this.code = code;
  }
}

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface Blit {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint8Array;
}

export function decodeImage(bytes: Uint8Array): DecodedImage {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const decoded = PNG.sync.read(Buffer.from(bytes));
      return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      const decoded = jpeg.decode(bytes, { useTArray: true });
      return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
    }
  } catch {
    throw new ImageError('image_invalid');
  }
  throw new ImageError('image_invalid');
}

function pixelBytes(
  img: DecodedImage,
  srcX: number,
  srcY: number,
  width: number,
  height: number,
  scaledWidth: number,
  scaledHeight: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 2);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((srcY + y) * img.height) / scaledHeight));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((srcX + x) * img.width) / scaledWidth));
      const source = (sy * img.width + sx) * 4;
      const color = rgb565(img.rgba[source] ?? 0, img.rgba[source + 1] ?? 0, img.rgba[source + 2] ?? 0);
      out[offset++] = color >> 8;
      out[offset++] = color & 0xff;
    }
  }
  return out;
}

export function planBlits(
  img: DecodedImage,
  opts: { x: number; y: number; fit: 'contain' | 'none' },
): { width: number; height: number; blits: Blit[] } {
  if (img.width <= 0 || img.height <= 0 || img.rgba.byteLength < img.width * img.height * 4) {
    throw new ImageError('image_invalid');
  }

  let scaledWidth = img.width;
  let scaledHeight = img.height;
  let drawX = opts.x;
  let drawY = opts.y;
  let srcX = 0;
  let srcY = 0;

  if (opts.fit === 'contain') {
    const scale = Math.min(HTNOS_SCREEN_WIDTH / img.width, HTNOS_SCREEN_HEIGHT / img.height, 1);
    scaledWidth = Math.max(1, Math.floor(img.width * scale));
    scaledHeight = Math.max(1, Math.floor(img.height * scale));
    drawX = Math.floor((HTNOS_SCREEN_WIDTH - scaledWidth) / 2);
    drawY = Math.floor((HTNOS_SCREEN_HEIGHT - scaledHeight) / 2);
  } else {
    srcX = Math.max(0, -drawX);
    srcY = Math.max(0, -drawY);
    drawX = Math.max(0, drawX);
    drawY = Math.max(0, drawY);
  }

  const width = Math.max(0, Math.min(scaledWidth - srcX, HTNOS_SCREEN_WIDTH - drawX));
  const height = Math.max(0, Math.min(scaledHeight - srcY, HTNOS_SCREEN_HEIGHT - drawY));
  if (width === 0 || height === 0) return { width: 0, height: 0, blits: [] };
  const blits: Blit[] = [];
  for (let row = 0; row < height; row += HTNOS_BLIT_ROWS) {
    const h = Math.min(HTNOS_BLIT_ROWS, height - row);
    blits.push({
      x: drawX,
      y: drawY + row,
      w: width,
      h,
      pixels: pixelBytes(img, srcX, srcY + row, width, h, scaledWidth, scaledHeight),
    });
  }
  return { width, height, blits };
}

export function decodeBase64Image(value: string): Uint8Array {
  const base64 = value.replace(/^data:[^;,]+;base64,/i, '');
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new ImageError('image_invalid');
  }
  try {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch {
    throw new ImageError('image_invalid');
  }
}
