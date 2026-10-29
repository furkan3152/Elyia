import { cx, FOCUS_RING } from "../../ui/cx";
import { ControlsSection } from "./ControlsSection";
import { DataSection } from "./DataSection";
import { FoundationsSection } from "./FoundationsSection";
import { OverlaysSection } from "./OverlaysSection";
import { VisualsSection } from "./VisualsSection";

const NAV = [
  ["colors", "Colours"],
  ["type", "Type"],
  ["buttons", "Buttons"],
  ["badges", "Badges"],
  ["inputs", "Inputs"],
  ["panels", "Panels"],
  ["charts", "Charts"],
  ["table", "Table"],
  ["identity", "Identity"],
  ["overlays", "Overlays"],
  ["sun", "Sun"],
  ["lyre", "Lyre"],
  ["constellation", "Stars"],
  ["aurora", "Aurora"],
] as const;

/**
 * /kit (dev server only): the living reference of Elyia's interface kit for
 * feature engineers. Every section shows the import, a minimal usage and the
 * component itself. Sample values here are documentation, never data.
 */
export default function KitPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-8 lg:px-10">
      <header className="pb-8 pt-4">
        <p className="eyebrow">Elyia kit · dev only</p>
        <h1 className="mt-3 font-display text-display-lg text-text-0">
          The instrument, <span className="display-italic">string by string.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-text-1">
          Import components from <code className="font-mono text-text-0">src/ui</code>, visuals from <code className="font-mono text-text-0">src/visuals</code>, motion from{" "}
          <code className="font-mono text-text-0">src/motion</code>. Variants come from props; className is for layout only. Numbers are tabular; money never tweens.
        </p>
        <nav aria-label="Kit sections" className="mt-6 flex flex-wrap gap-1.5">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={cx("rounded-lg border border-line px-2.5 py-1 font-mono text-xs text-text-1 hover:border-violet-glow/40 hover:text-text-0", FOCUS_RING)}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <FoundationsSection />
      <ControlsSection />
      <DataSection />
      <OverlaysSection />
      <VisualsSection />
    </div>
  );
}
