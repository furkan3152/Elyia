/**
 * Contouring (pure): sample a scalar field on a grid, trace iso-lines with
 * marching squares, stitch the cell segments into polylines (closed rings
 * where the line closes on itself) and smooth them into SVG paths.
 *
 * Segments are joined by the grid EDGE they cross, not by rounded
 * coordinates, so stitching is exact and every ring that closes is reported
 * as closed. Saddle cells are resolved with the cell-centre average.
 */

export type Point = readonly [number, number];

export interface Field {
  /** Samples per row / column. */
  readonly nx: number;
  readonly ny: number;
  /** Grid spacing in output units. */
  readonly step: number;
  readonly width: number;
  readonly height: number;
  /** Row-major values, values[j * nx + i] at (i * step, j * step). */
  readonly values: Float64Array;
  readonly min: number;
  readonly max: number;
}

export interface Polyline {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

/** Samples `fn` on a grid that covers [0, width] x [0, height]. */
export function sampleField(width: number, height: number, step: number, fn: (x: number, y: number) => number): Field {
  const nx = Math.floor(width / step) + 1;
  const ny = Math.floor(height / step) + 1;
  const values = new Float64Array(nx * ny);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const value = fn(i * step, j * step);
      values[j * nx + i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return { nx, ny, step, width, height, values, min, max };
}

/** Bilinear value of the field at (x, y). */
export function fieldAt(field: Field, x: number, y: number): number {
  const fx = Math.min(field.nx - 1.000001, Math.max(0, x / field.step));
  const fy = Math.min(field.ny - 1.000001, Math.max(0, y / field.step));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const v = field.values;
  const a = v[j * field.nx + i]!;
  const b = v[j * field.nx + i + 1]!;
  const c = v[(j + 1) * field.nx + i]!;
  const d = v[(j + 1) * field.nx + i + 1]!;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/*
 * Edge ids: horizontal edge from (i, j) to (i+1, j) is `2 * (j * nx + i)`,
 * vertical edge from (i, j) to (i, j+1) is `2 * (j * nx + i) + 1`.
 */
function hEdge(field: Field, i: number, j: number): number {
  return 2 * (j * field.nx + i);
}
function vEdge(field: Field, i: number, j: number): number {
  return 2 * (j * field.nx + i) + 1;
}

function edgePoint(field: Field, edge: number, level: number): Point {
  const node = edge >> 1;
  const i = node % field.nx;
  const j = Math.floor(node / field.nx);
  const vertical = (edge & 1) === 1;
  const a = field.values[j * field.nx + i]!;
  const b = vertical ? field.values[(j + 1) * field.nx + i]! : field.values[j * field.nx + i + 1]!;
  const t = b === a ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
  const x0 = i * field.step;
  const y0 = j * field.step;
  return vertical ? [x0, y0 + t * field.step] : [x0 + t * field.step, y0];
}

/** Marching squares + stitching: every iso-line of `level` as a polyline. */
export function isolines(field: Field, level: number): Polyline[] {
  if (!(level > field.min && level < field.max)) return [];
  const { nx, ny, values } = field;
  // adjacency: edge id -> up to two segment partners
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };

  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const tl = values[j * nx + i]!;
      const tr = values[j * nx + i + 1]!;
      const br = values[(j + 1) * nx + i + 1]!;
      const bl = values[(j + 1) * nx + i]!;
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = hEdge(field, i, j);
      const bottom = hEdge(field, i, j + 1);
      const left = vEdge(field, i, j);
      const right = vEdge(field, i + 1, j);
      switch (code) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(left, top);
          break;
        case 5:
        case 10: {
          // Saddle. Code 5: tr and bl above; code 10: tl and br above. When the
          // centre is above, the two above corners join through the middle.
          const centreAbove = (tl + tr + br + bl) / 4 > level;
          if ((code === 5) === centreAbove) {
            link(left, top);
            link(bottom, right);
          } else {
            link(left, bottom);
            link(top, right);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  const visited = new Set<number>();
  const lines: Polyline[] = [];
  const walk = (start: number, from: number | null): number[] => {
    const chain: number[] = [];
    let current: number | null = start;
    let previous = from;
    while (current !== null) {
      chain.push(current);
      visited.add(current);
      const partners: number[] = links.get(current) ?? [];
      let next: number | null = null;
      for (const candidate of partners) {
        if (candidate !== previous && !visited.has(candidate)) {
          next = candidate;
          break;
        }
      }
      previous = current;
      current = next;
    }
    return chain;
  };

  // Open lines first (they start at an edge with a single partner: the grid border).
  for (const [edge, partners] of links) {
    if (visited.has(edge) || partners.length !== 1) continue;
    const chain = walk(edge, null);
    if (chain.length >= 2) lines.push({ points: chain.map((e) => edgePoint(field, e, level)), closed: false });
  }
  // Everything left is a closed ring.
  for (const edge of links.keys()) {
    if (visited.has(edge)) continue;
    const chain = walk(edge, null);
    if (chain.length >= 3) lines.push({ points: chain.map((e) => edgePoint(field, e, level)), closed: true });
  }
  return lines;
}

/** Signed area (shoelace); positive is clockwise in SVG's y-down space. */
export function polygonArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Point-in-polygon (even-odd). */
export function ringContains(points: readonly Point[], [px, py]: Point): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index]!;
    const [xj, yj] = points[previous]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function perpendicularDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
}

/** Ramer-Douglas-Peucker simplification (keeps the ends). */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let index = -1;
    let distance = 0;
    for (let k = first + 1; k < last; k += 1) {
      const d = perpendicularDistance(points[k]!, points[first]!, points[last]!);
      if (d > distance) {
        distance = d;
        index = k;
      }
    }
    if (index > 0 && distance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

const fmt = (value: number) => (Math.round(value * 10) / 10).toString();

/**
 * A smooth SVG path through `points` (Catmull-Rom converted to cubic
 * Béziers). Closed rings wrap around so the join has no kink.
 */
export function smoothPath(points: readonly Point[], closed: boolean, tension = 1): string {
  const n = points.length;
  if (n === 0) return "";
  if (n < 3) return `M${points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L")}`;
  const at = (index: number): Point => {
    if (closed) return points[((index % n) + n) % n]!;
    return points[Math.max(0, Math.min(n - 1, index))]!;
  };
  const k = tension / 6;
  let d = `M${fmt(points[0]![0])},${fmt(points[0]![1])}`;
  const segments = closed ? n : n - 1;
  for (let index = 0; index < segments; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) * k;
    const c1y = p1[1] + (p2[1] - p0[1]) * k;
    const c2x = p2[0] - (p3[0] - p1[0]) * k;
    const c2y = p2[1] - (p3[1] - p1[1]) * k;
    d += `C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2[0])},${fmt(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Total length of a polyline (for draw-on timing). */
export function polylineLength(points: readonly Point[], closed = false): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  }
  if (closed && points.length > 2) total += Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]);
  return total;
}
