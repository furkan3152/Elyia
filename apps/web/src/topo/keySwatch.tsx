/** Swatch helpers for MapKey (16-24 px SVGs). */
export const KeySwatch = {
  line: (color: string, dashed = false, width = 1.4) => (
    <svg width="24" height="10" viewBox="0 0 24 10">
      <path d="M1 5h22" stroke={color} strokeWidth={width} strokeDasharray={dashed ? "3 2.5" : undefined} />
    </svg>
  ),
  fill: (color: string) => (
    <svg width="16" height="10" viewBox="0 0 16 10">
      <rect x="0.75" y="0.75" width="14.5" height="8.5" fill={color} stroke="rgb(var(--rule))" strokeWidth="1" />
    </svg>
  ),
  peak: () => (
    <svg width="14" height="12" viewBox="0 0 14 12">
      <path d="M7 1 13 11H1Z" fill="rgb(var(--ink))" />
    </svg>
  ),
};

