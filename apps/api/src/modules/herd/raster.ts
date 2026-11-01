/**
 * Server-side pixel raster: an RGBA buffer with the small slice of the
 * canvas 2D API the pixel kit draws with (fillStyle + fillRect), a 5×7 pixel
 * font, and a PNG encoder (zlib from node). Enough to render the Herd art
 * generator's output, the placeholder and the WL card without a browser.
 */
import { deflateSync } from "node:zlib";

/* ------------------------------------------------------------- colors */

export type Rgba = readonly [number, number, number, number];

export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  let match = /^#([0-9a-f]{3,8})$/u.exec(value);
  if (match) {
    const hex = match[1]!;
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = "f"] = hex.split("");
      return [parseInt(r! + r!, 16), parseInt(g! + g!, 16), parseInt(b! + b!, 16), parseInt(a + a, 16)];
    }
    if (hex.length === 6 || hex.length === 8) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255];
    return null;
  }
  match = /^rgba?\(([^)]+)\)$/u.exec(value);
  if (match) {
    const parts = match[1]!.split(/[\s,/]+/u).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
    const alpha = parts[3] === undefined ? 1 : parts[3]!;
    return [parts[0]!, parts[1]!, parts[2]!, Math.round(Math.max(0, Math.min(1, alpha)) * 255)];
  }
  if (value === "transparent") return [0, 0, 0, 0];
  if (value === "white") return [255, 255, 255, 255];
  if (value === "black") return [0, 0, 0, 255];
  return null;
}

/* ------------------------------------------------------------- raster */

export class Raster {
  readonly data: Uint8Array;
  fillStyle: string = "#000000";
  strokeStyle: string = "#000000";
  globalAlpha = 1;
  imageSmoothingEnabled = false;
  lineWidth = 1;
  font = "";
  textAlign = "left";
  textBaseline = "alphabetic";
  readonly canvas: { width: number; height: number; getContext: () => Raster };

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
    this.canvas = { width, height, getContext: () => this };
  }

  private blend(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 4;
    const alpha = (color[3] / 255) * this.globalAlpha;
    if (alpha >= 1) {
      this.data[offset] = color[0];
      this.data[offset + 1] = color[1];
      this.data[offset + 2] = color[2];
      this.data[offset + 3] = 255;
      return;
    }
    const under = this.data[offset + 3]! / 255;
    const out = alpha + under * (1 - alpha);
    if (out <= 0) return;
    for (let channel = 0; channel < 3; channel += 1) this.data[offset + channel] = Math.round((color[channel]! * alpha + this.data[offset + channel]! * under * (1 - alpha)) / out);
    this.data[offset + 3] = Math.round(out * 255);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const color = parseColor(typeof this.fillStyle === "string" ? this.fillStyle : "#000");
    if (!color) return;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py += 1) for (let px = x0; px < x1; px += 1) this.blend(px, py, color);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py += 1) for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px += 1) this.data.fill(0, (py * this.width + px) * 4, (py * this.width + px) * 4 + 4);
  }

  // No-ops the pixel kit may call.
  save(): void {}
  restore(): void {}
  setTransform(): void {}
  resetTransform(): void {}
  scale(): void {}
  translate(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  fill(): void {}
  fillText(): void {}

  /** Copies `source` at (dx, dy) scaled by an integer factor (nearest neighbour). */
  blit(source: Raster, dx: number, dy: number, scale = 1): void {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const offset = (y * source.width + x) * 4;
        const color: Rgba = [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!, source.data[offset + 3]!];
        if (color[3] === 0) continue;
        for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) this.blend(dx + x * scale + sx, dy + y * scale + sy, color);
      }
    }
  }

  /** The whole raster scaled up (nearest neighbour). */
  scaled(factor: number): Raster {
    const out = new Raster(this.width * factor, this.height * factor);
    out.blit(this, 0, 0, factor);
    return out;
  }

  png(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}

/* -------------------------------------------------------------- PNG */

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
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

/* ------------------------------------------------------------- font */

/** 5×7 glyphs, rows top to bottom ("#" = ink). */
const GLYPHS: Readonly<Record<string, string>> = {
  A: ".###.#...##...#######...##...##...#",
  B: "####.#...##...#####.#...##...#####.",
  C: ".###.#...##....#....#....#...#.###.",
  D: "####.#...##...##...##...##...#####.",
  E: "######....#....####.#....#....#####",
  F: "######....#....####.#....#....#....",
  G: ".###.#...##....#.####...##...#.###.",
  H: "#...##...##...#######...##...##...#",
  I: ".###...#....#....#....#....#...###.",
  J: "..###...#....#....#....#.#..#..##..",
  K: "#...##..#.#.#..##...#.#..#..#.#...#",
  L: "#....#....#....#....#....#....#####",
  M: "#...###.###.#.##...##...##...##...#",
  N: "#...###..##.#.##..###...##...##...#",
  O: ".###.#...##...##...##...##...#.###.",
  P: "####.#...##...#####.#....#....#....",
  Q: ".###.#...##...##...##.#.##..#..##.#",
  R: "####.#...##...#####.#.#..#..#.#...#",
  S: ".#####....#.....###.....#....#####.",
  T: "#####..#....#....#....#....#....#..",
  U: "#...##...##...##...##...##...#.###.",
  V: "#...##...##...##...##...#.#.#...#..",
  W: "#...##...##...##.#.##.#.##.#.#.#.#.",
  X: "#...##...#.#.#...#...#.#.#...##...#",
  Y: "#...##...#.#.#...#....#....#....#..",
  Z: "#####....#...#...#...#...#....#####",
  "0": ".###.#...##..###.#.###..##...#.###.",
  "1": "..#...##....#....#....#....#...###.",
  "2": ".###.#...#....#...#...#...#...#####",
  "3": "####.....#....#.###.....#....#####.",
  "4": "...#...##..#.#.#..#.#####...#....#.",
  "5": "######....####.....#....#....#####.",
  "6": "..##..#...#....####.#...##...#.###.",
  "7": "#####....#...#...#...#....#....#...",
  "8": ".###.#...##...#.###.#...##...#.###.",
  "9": ".###.#...##...#.####....#...#..##..",
  ".": "..............................##...",
  ",": ".........................##...#...#",
  ":": ".......##....................##....",
  "/": "....#....#...#...#...#...#....#....",
  "-": "...............#####...............",
  "+": ".......#....#..#####..#....#.......",
  "@": ".###.#...##.####.#.##.####.....###.",
  "#": ".#.#..#.#.#####.#.#.#####.#.#..#.#.",
  "%": "##...##..#...#...#...#...#..##...##",
  "×": "......#...#.#.#...#...#.#.#...#....",
  "·": ".................#.................",
  "?": ".###.#...#....#...#...#.........#..",
  "!": "..#....#....#....#....#.........#..",
  "_": "..............................#####",
  "(": "...#...#...#....#....#.....#.....#.",
  ")": ".#.....#.....#....#....#...#...#...",
  " ": "...................................",
};

function glyph(char: string): string {
  const raw = GLYPHS[char] ?? GLYPHS[char.toUpperCase()] ?? GLYPHS["?"]!;
  return raw.padEnd(35, ".").slice(0, 35);
}

/** Draws `text` in the 5×7 font at (x, y), each font pixel `scale` raster pixels. Returns the width drawn. */
export function drawText(raster: Raster, text: string, x: number, y: number, color: string, scale = 1): number {
  raster.fillStyle = color;
  let cursor = x;
  for (const char of text) {
    const rows = glyph(char);
    for (let row = 0; row < 7; row += 1) for (let col = 0; col < 5; col += 1) if (rows[row * 5 + col] === "#") raster.fillRect(cursor + col * scale, y + row * scale, scale, scale);
    cursor += 6 * scale;
  }
  return cursor - x;
}

export function textWidth(text: string, scale = 1): number {
  return [...text].length * 6 * scale - scale;
}
