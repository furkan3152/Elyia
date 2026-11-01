/**
 * A tiny PNG codec on node:zlib (no dependencies). Encodes 8-bit RGB or RGBA,
 * nearest-neighbour upscaled art with the "Up" filter (every repeated row
 * becomes zeros, so a 960 px goat deflates to a few kilobytes). The decoder
 * exists for tests and tooling: it reads what this encoder (or any
 * non-interlaced 8-bit RGB/RGBA PNG) writes.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const body = Buffer.concat([head.subarray(4), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, crc]);
}

export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** 3 (RGB) or 4 (RGBA). */
  readonly channels: 3 | 4;
  /** Row-major pixel bytes, `width * height * channels` long. */
  readonly data: Uint8Array;
}

/** Encodes a raster as PNG (8-bit, non-interlaced, "Up" filter on every row but the first). */
export function encodePng(image: RasterImage): Buffer {
  const { width, height, channels, data } = image;
  if (data.length !== width * height * channels) throw new Error(`png: expected ${width * height * channels} bytes, got ${data.length}`);
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const out = y * (stride + 1);
    const row = y * stride;
    if (y === 0) {
      raw[out] = 0;
      raw.set(data.subarray(row, row + stride), out + 1);
      continue;
    }
    raw[out] = 2;
    for (let i = 0; i < stride; i += 1) raw[out + 1 + i] = (data[row + i]! - data[row - stride + i]!) & 0xff;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes an 8-bit RGB/RGBA non-interlaced PNG (tests and tooling). Checks the signature and every CRC. */
export function decodePng(png: Uint8Array): RasterImage {
  const buf = Buffer.from(png);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("png: bad signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    const crc = buf.readUInt32BE(offset + 8 + length);
    if (crc32(buf.subarray(offset + 4, offset + 8 + length)) !== crc) throw new Error(`png: bad crc in ${type}`);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 2 && data[9] !== 6)) throw new Error("png: only 8-bit RGB/RGBA, non-interlaced");
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i]!;
      const a = i >= channels ? out[dst + i - channels]! : 0;
      const b = y > 0 ? out[dst - stride + i]! : 0;
      const c = i >= channels && y > 0 ? out[dst - stride + i - channels]! : 0;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : paeth(a, b, c) + x;
      out[dst + i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** Parses "#RRGGBB" into [r, g, b]. */
export function rgbOf(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Rasterises a colour grid (`grid[y][x]` hex or null) at `scale` device pixels
 * per art pixel, nearest neighbour. Null cells become `background`, or
 * transparent when the raster is RGBA and no background is given.
 */
export function rasterize(grid: ReadonlyArray<ReadonlyArray<string | null>>, scale: number, options: { readonly channels?: 3 | 4; readonly background?: string } = {}): RasterImage {
  const channels = options.channels ?? 3;
  const h = grid.length;
  const w = grid.reduce((m, row) => Math.max(m, row.length), 0);
  const width = w * scale;
  const height = h * scale;
  const data = new Uint8Array(width * height * channels);
  const bg = options.background ? rgbOf(options.background) : null;
  const cache = new Map<string, readonly [number, number, number]>();
  for (let y = 0; y < h; y += 1) {
    const row = grid[y]!;
    for (let x = 0; x < w; x += 1) {
      const hex = row[x] ?? null;
      let rgb: readonly [number, number, number] | null = bg;
      if (hex) {
        rgb = cache.get(hex) ?? rgbOf(hex);
        cache.set(hex, rgb);
      }
      if (!rgb && channels === 3) rgb = [0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        let p = ((y * scale + sy) * width + x * scale) * channels;
        for (let sx = 0; sx < scale; sx += 1) {
          if (rgb) {
            data[p] = rgb[0];
            data[p + 1] = rgb[1];
            data[p + 2] = rgb[2];
            if (channels === 4) data[p + 3] = 255;
          }
          p += channels;
        }
      }
    }
  }
  return { width, height, channels, data };
}

/**
 * Encodes a colour grid upscaled `scale` times, byte for byte the same PNG as
 * `encodePng(rasterize(grid, scale))` (RGB), without building the raster:
 * only each art row's first scanline carries data, the repeats are "Up" zeros.
 */
export function encodeGridPng(grid: ReadonlyArray<ReadonlyArray<string | null>>, scale: number, background = "#000000"): Buffer {
  const h = grid.length;
  const w = grid.reduce((m, row) => Math.max(m, row.length), 0);
  const width = w * scale;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * h * scale);
  const bg = rgbOf(background);
  let previous: Uint8Array | null = null;
  for (let y = 0; y < h; y += 1) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < w; x += 1) {
      const hex = grid[y]![x];
      const [r, g, b] = hex ? rgbOf(hex) : bg;
      for (let sx = 0; sx < scale; sx += 1) {
        const p = (x * scale + sx) * 3;
        line[p] = r;
        line[p + 1] = g;
        line[p + 2] = b;
      }
    }
    for (let sy = 0; sy < scale; sy += 1) {
      const out = (y * scale + sy) * (stride + 1);
      if (y === 0 && sy === 0) {
        raw[out] = 0;
        raw.set(line, out + 1);
      } else {
        raw[out] = 2;
        if (sy === 0 && previous) for (let i = 0; i < stride; i += 1) raw[out + 1 + i] = (line[i]! - previous[i]!) & 0xff;
      }
    }
    previous = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(h * scale, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}
