/**
 * Constellation layout (pure, deterministic). Nodes are grouped into skies
 * (HyperCore, HyperEVM, Elysium, ...), laid out side by side; inside a sky
 * each star gets a seeded position in an ellipse, then a few relaxation
 * passes push overlapping stars apart. Same input -> same picture, so a
 * portfolio never reshuffles on refresh.
 */

export interface StarNode {
  readonly id: string;
  readonly label: string;
  /** Sky id the star belongs to. */
  readonly group: string;
  /** Size driver (USD value); radius grows with its square root. */
  readonly value: number;
  readonly sublabel?: string;
}

export interface StarLink {
  readonly source: string;
  readonly target: string;
  /** "path": an intent's route (dashed); "hedge": offsetting legs; "link": plain relation. */
  readonly kind?: "path" | "hedge" | "link";
}

export interface SkyGroup {
  readonly id: string;
  readonly label: string;
}

export interface PlacedStar {
  readonly node: StarNode;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface PlacedSky {
  readonly group: SkyGroup;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export interface ConstellationLayout {
  readonly stars: readonly PlacedStar[];
  readonly skies: readonly PlacedSky[];
}

/** 32-bit FNV-1a hash of a string, for seeding. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: tiny seeded PRNG in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LayoutOptions {
  readonly minRadius?: number;
  readonly maxRadius?: number;
  /** Relaxation passes against overlaps. */
  readonly iterations?: number;
  /** Inner padding of each sky, px. */
  readonly padding?: number;
}

export function starRadius(value: number, maxValue: number, minRadius: number, maxRadius: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxValue) || maxValue <= 0) return minRadius;
  return minRadius + (maxRadius - minRadius) * Math.sqrt(Math.min(1, value / maxValue));
}

export function layoutConstellation(nodes: readonly StarNode[], groups: readonly SkyGroup[], width: number, height: number, options: LayoutOptions = {}): ConstellationLayout {
  const minRadius = options.minRadius ?? 3;
  const maxRadius = options.maxRadius ?? Math.max(8, Math.min(width, height) * 0.075);
  const iterations = options.iterations ?? 24;
  const padding = options.padding ?? 18;
  if (width <= 0 || height <= 0 || groups.length === 0) return { stars: [], skies: [] };

  const columnWidth = width / groups.length;
  const skies: PlacedSky[] = groups.map((group, index) => ({
    group,
    cx: columnWidth * (index + 0.5),
    cy: height * (index % 2 === 0 ? 0.47 : 0.53),
    rx: Math.max(10, columnWidth / 2 - padding),
    ry: Math.max(10, height / 2 - padding - 14),
  }));
  const skyById = new Map(skies.map((sky) => [sky.group.id, sky]));
  const maxValue = Math.max(0, ...nodes.map((node) => (Number.isFinite(node.value) ? node.value : 0)));

  const placed = nodes
    .filter((node) => skyById.has(node.group))
    .map((node) => {
      const sky = skyById.get(node.group)!;
      const random = seededRandom(hashString(`${node.group}:${node.id}`));
      // Uniform in the ellipse: sqrt for radius, random angle.
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 0.82;
      return {
        node,
        x: sky.cx + Math.cos(angle) * sky.rx * distance,
        y: sky.cy + Math.sin(angle) * sky.ry * distance,
        r: starRadius(node.value, maxValue, minRadius, maxRadius),
      };
    });

  for (let pass = 0; pass < iterations; pass += 1) {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (a.node.group !== b.node.group) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        // Room for the label under each star, not just the discs.
        const wanted = a.r + b.r + 28;
        if (distance >= wanted) continue;
        const push = (wanted - distance) / 2;
        const ux = dx / distance;
        const uy = dy / distance;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    // Keep every star inside its sky.
    for (const star of placed) {
      const sky = skyById.get(star.node.group)!;
      const nx = (star.x - sky.cx) / Math.max(1, sky.rx - star.r);
      const ny = (star.y - sky.cy) / Math.max(1, sky.ry - star.r);
      const norm = Math.hypot(nx, ny);
      if (norm > 1) {
        star.x = sky.cx + (nx / norm) * (sky.rx - star.r);
        star.y = sky.cy + (ny / norm) * (sky.ry - star.r);
      }
    }
  }

  return {
    stars: placed.map((star) => ({ node: star.node, x: Math.round(star.x * 10) / 10, y: Math.round(star.y * 10) / 10, r: Math.round(star.r * 10) / 10 })),
    skies,
  };
}
