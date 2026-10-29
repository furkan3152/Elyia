import { KitSection, Swatch } from "./KitSection";

const COLORS: ReadonlyArray<readonly [string, string, string]> = [
  ["bg-0", "bg-bg-0", "page"],
  ["bg-1", "bg-bg-1", "panel"],
  ["bg-2", "bg-bg-2", "raised, inputs"],
  ["bg-3", "bg-bg-3", "hover on raised"],
  ["text-0", "bg-text-0", "primary text"],
  ["text-1", "bg-text-1", "secondary text"],
  ["text-2", "bg-text-2", "tertiary, labels (AA)"],
  ["violet", "bg-violet", "purple light, brand"],
  ["violet-glow", "bg-violet-glow", "focus, strings"],
  ["violet-soft", "bg-violet-soft", "italic display"],
  ["gold", "bg-gold", "their own sun, accent"],
  ["gold-deep", "bg-gold-deep", "the lyre's base"],
  ["mint", "bg-mint", "up / long"],
  ["rose", "bg-rose", "down / short"],
  ["sky", "bg-sky", "info, HyperEVM"],
];

/** Tokens and type. */
export function FoundationsSection() {
  return (
    <>
      <KitSection
        id="colors"
        title="Colour tokens"
        description={
          <>
            CSS variables in <code className="font-mono">src/styles/tokens.css</code> (dark default, light via <code className="font-mono">html[data-theme=&quot;light&quot;]</code>).
            Tailwind maps them: <code className="font-mono">bg-bg-1 text-text-1 border-line text-gold bg-violet/15</code>. The palette is replaced, not extended, so off-palette
            colours do not exist.
          </>
        }
        code={'<div className="rounded-2xl border border-line bg-bg-1 text-text-1">…</div>\n<span className="text-mint">+4.2%</span>  <span className="bg-gold-fill text-ink-gold">Sign</span>'}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {COLORS.map(([name, className, note]) => (
            <Swatch key={name} name={name} className={className} note={note} />
          ))}
        </div>
      </KitSection>
      <KitSection
        id="type"
        title="Typography"
        description="Instrument Serif for display (italic, violet-soft, for poetic accents), Inter Variable for UI, JetBrains Mono Variable for data. Every number is tabular: add tnum. 12 px is the floor for anything a person must read."
        code={'<h1 className="font-display text-display-lg">Seven strings. <span className="display-italic">Your whole book.</span></h1>\n<p className="eyebrow">The Lyre</p>  <span className="tnum font-mono">18,431,206</span>'}
      >
        <div className="flex flex-col gap-4">
          <p className="eyebrow">Eyebrow · gold mono caps</p>
          <p className="font-display text-display-lg text-text-0">
            Their own sun. <span className="display-italic">Their own stars.</span>
          </p>
          <p className="max-w-2xl text-[15px] text-text-1">Inter for interface copy: dense but calm, plain words, the fix in every error.</p>
          <p className="tnum font-mono text-2xl text-text-0">$48,213.07 · 114 ms · 0.10 gwei</p>
          <p className="label-caps">label-caps · panel headers</p>
        </div>
      </KitSection>
    </>
  );
}
