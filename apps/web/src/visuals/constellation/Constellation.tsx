import { useId, useMemo, useRef, useState } from "react";

import { cx, FOCUS_RING } from "../../ui/cx";
import type { Tone } from "../../ui/tones";
import { useElementSize } from "../canvas";
import { layoutConstellation, type SkyGroup, type StarLink, type StarNode } from "./layout";

export interface ConstellationGroup extends SkyGroup {
  readonly tone: Tone;
}

export interface ConstellationProps {
  readonly nodes: readonly StarNode[];
  readonly links?: readonly StarLink[];
  readonly groups: readonly ConstellationGroup[];
  /** Accessible name ("Portfolio constellation: 9 holdings across 3 layers"). */
  readonly label: string;
  readonly height?: number;
  readonly onSelect?: (id: string) => void;
  readonly selectedId?: string | null;
  /** Labels for the N largest stars (default 6). */
  readonly labelTop?: number;
  readonly className?: string;
}

const CHANNEL: Readonly<Record<Tone, string>> = {
  violet: "--violet-glow",
  gold: "--gold",
  mint: "--mint",
  rose: "--rose",
  sky: "--sky",
  neutral: "--text-1",
};

function rgb(tone: Tone, alpha = 1) {
  return `rgb(var(${CHANNEL[tone]}) / ${alpha})`;
}

/**
 * Own Stars — a portfolio constellation. One sky per layer, one star per
 * holding sized by value (radius ∝ √value), links for intent paths and
 * hedges. SVG, deterministic layout; the largest stars twinkle gently (CSS,
 * at most 12, off with reduced motion). Stars are focusable buttons.
 */
export function Constellation({ nodes, links = [], groups, label, height = 320, onSelect, selectedId = null, labelTop = 6, className }: ConstellationProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(wrapRef);
  const gradientPrefix = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => layoutConstellation(nodes, groups, width, height), [nodes, groups, width, height]);
  const toneByGroup = useMemo(() => new Map(groups.map((group) => [group.id, group.tone])), [groups]);
  const starById = useMemo(() => new Map(layout.stars.map((star) => [star.node.id, star])), [layout]);
  const labelled = useMemo(() => new Set([...layout.stars].sort((a, b) => b.node.value - a.node.value).slice(0, labelTop).map((star) => star.node.id)), [layout, labelTop]);
  const twinkling = useMemo(() => new Set([...layout.stars].sort((a, b) => b.node.value - a.node.value).slice(0, 12).map((star) => star.node.id)), [layout]);
  const active = hovered ?? selectedId;
  const activeStar = active ? starById.get(active) : undefined;

  return (
    <div ref={wrapRef} className={cx("relative w-full", className)} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label} className="block overflow-visible">
          <defs>
            {groups.map((group) => (
              <radialGradient key={group.id} id={`${gradientPrefix}-${group.id}`}>
                <stop offset="0%" stopColor="rgb(255 255 255)" stopOpacity="0.95" />
                <stop offset="35%" stopColor={rgb(group.tone, 1)} stopOpacity="0.95" />
                <stop offset="100%" stopColor={rgb(group.tone, 0)} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>
          {layout.skies.map((sky) => {
            const tone = toneByGroup.get(sky.group.id) ?? "neutral";
            return (
              <g key={sky.group.id} aria-hidden="true">
                <ellipse cx={sky.cx} cy={sky.cy} rx={sky.rx} ry={sky.ry} fill={rgb(tone, 0.035)} stroke={rgb(tone, 0.14)} strokeDasharray="2 6" />
                <text x={sky.cx} y={height - 6} textAnchor="middle" className="font-mono" fontSize="12" letterSpacing="0.14em" fill={rgb(tone, 0.9)}>
                  {sky.group.label.toUpperCase()}
                </text>
              </g>
            );
          })}
          <g aria-hidden="true">
            {links.map((link) => {
              const a = starById.get(link.source);
              const b = starById.get(link.target);
              if (!a || !b) return null;
              const lit = active === link.source || active === link.target;
              return (
                <line
                  key={`${link.source}-${link.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={link.kind === "hedge" ? rgb("rose", lit ? 0.7 : 0.35) : link.kind === "path" ? rgb("gold", lit ? 0.9 : 0.55) : "var(--line-strong)"}
                  strokeWidth={lit ? 1.5 : 1}
                  strokeDasharray={link.kind === "path" ? "3 5" : undefined}
                />
              );
            })}
          </g>
          {layout.stars.map((star, index) => {
            const tone = toneByGroup.get(star.node.group) ?? "neutral";
            const isActive = active === star.node.id;
            return (
              <g key={star.node.id}>
                <circle
                  cx={star.x}
                  cy={star.y}
                  r={star.r * 2.4}
                  fill={`url(#${gradientPrefix}-${star.node.group})`}
                  opacity={isActive ? 0.9 : 0.55}
                  className={twinkling.has(star.node.id) ? "el-loop animate-twinkle" : undefined}
                  style={twinkling.has(star.node.id) ? { animationDelay: `${(index * 397) % 3200}ms` } : undefined}
                  aria-hidden="true"
                />
                <circle cx={star.x} cy={star.y} r={Math.max(1.5, star.r * 0.42)} fill="rgb(255 255 255)" aria-hidden="true" />
                {isActive ? <circle cx={star.x} cy={star.y} r={star.r + 6} fill="none" stroke={rgb(tone, 0.8)} aria-hidden="true" /> : null}
                {labelled.has(star.node.id) || isActive ? (
                  <text x={star.x} y={star.y + star.r + 16} textAnchor="middle" fontSize="12" className="font-mono" fill="rgb(var(--text-1))" aria-hidden="true">
                    {star.node.label}
                  </text>
                ) : null}
                <foreignObject x={star.x - Math.max(12, star.r)} y={star.y - Math.max(12, star.r)} width={Math.max(24, star.r * 2)} height={Math.max(24, star.r * 2)}>
                  <button
                    type="button"
                    aria-label={`${star.node.label}${star.node.sublabel ? `, ${star.node.sublabel}` : ""}`}
                    aria-pressed={selectedId === star.node.id}
                    onClick={() => onSelect?.(star.node.id)}
                    onPointerEnter={() => setHovered(star.node.id)}
                    onPointerLeave={() => setHovered((current) => (current === star.node.id ? null : current))}
                    onFocus={() => setHovered(star.node.id)}
                    onBlur={() => setHovered((current) => (current === star.node.id ? null : current))}
                    className={cx("h-full w-full cursor-pointer rounded-full bg-transparent", FOCUS_RING)}
                  />
                </foreignObject>
              </g>
            );
          })}
        </svg>
      ) : null}
      {activeStar ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full animate-fade-in whitespace-nowrap rounded-lg border border-line-strong bg-bg-1/95 px-2.5 py-1.5 text-center shadow-raised"
          style={{ left: activeStar.x, top: activeStar.y - activeStar.r - 10 }}
        >
          <div className="text-xs font-semibold text-text-0">{activeStar.node.label}</div>
          {activeStar.node.sublabel ? <div className="tnum font-mono text-xs text-text-1">{activeStar.node.sublabel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export type { SkyGroup, StarLink, StarNode } from "./layout";
