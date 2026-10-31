import { MotionToggle } from "../../app/shell/MotionToggle";
import { ThemeToggle } from "../../app/shell/ThemeToggle";
import { Page, Section } from "../../pixel/layout";
import { PixelScene } from "../../pixel/PixelScene";
import { cx, FOCUS_RING } from "../../ui/cx";
import { ArtifactsSection } from "./ArtifactsSection";
import { ElySection } from "./ElySection";
import { HerdSection } from "./HerdSection";
import { PrimitivesSection } from "./PrimitivesSection";
import { RulesSection } from "./RulesSection";
import { TerrainSection } from "./TerrainSection";
import { TokensSection } from "./TokensSection";

const INDEX = [
  ["tokens", "Tokens"],
  ["ely", "Ely"],
  ["terrain", "Terrain"],
  ["herd", "The Herd"],
  ["kit", "Kit"],
  ["primitives", "Primitives"],
  ["rules", "Rules"],
] as const;

/**
 * /system: the living Pixel Survey key. Every token, primitive, pixel
 * component and Ely state, on both sheets, with the layout rules. Sample
 * data is labelled as sample. This page is the visual QA surface for every
 * page engineer.
 */
export default function SystemPage() {
  return (
    <Page className="!pt-0">
      <Section
        level={1}
        tag="Sheet K · the Pixel Survey key"
        title={
          <>
            Every block a step.
            <br />
            Ely climbs to the summit.
          </>
        }
        lede="Floor to Ridge, Ridge to Summit: every layer is an altitude band, every action a step on the trail. This sheet holds everything Elyia draws, in its states, on both sheets."
        actions={
          <>
            <ThemeToggle />
            <MotionToggle />
          </>
        }
      >
        <PixelScene />
        <nav aria-label="Key sections" className="mt-12 flex flex-wrap justify-center gap-4">
          {INDEX.map(([id, label], index) => (
            <a key={id} href={`#${id}`} className={cx("inline-flex items-center gap-2 bg-card px-3 py-1.5 font-tag text-[12px] uppercase text-ink px-frame-thin px-drop px-press", FOCUS_RING)}>
              <span className="tnum text-ink-3">{String(index + 1).padStart(2, "0")}</span>
              {label}
            </a>
          ))}
        </nav>
      </Section>
      <TokensSection />
      <ElySection />
      <TerrainSection />
      <HerdSection />
      <ArtifactsSection />
      <PrimitivesSection />
      <RulesSection />
    </Page>
  );
}
