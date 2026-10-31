import { useCallback } from "react";

import { Cards, Section } from "../../pixel/layout";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { Blaze } from "../../topo/Blaze";
import type { Grade } from "../../topo/geometry/conditions";
import { paintSlope, SLOPE_H, SLOPE_W, type GradeBand } from "./gradeSlope";

const GRADES: ReadonlyArray<{ readonly band: GradeBand; readonly grades: readonly [Grade, Grade]; readonly name: string; readonly body: string; readonly ely: string }> = [
  { band: "trail", grades: [1, 2], name: "Trail", body: "Swaps, stakes, bridges, transfers.", ely: "Ely strolls." },
  { band: "mountain", grades: [3, 4], name: "Mountain", body: "Perps up to 10×, fresh but checked tokens.", ely: "Ely ropes up." },
  { band: "alpine", grades: [5, 6], name: "Alpine", body: "Above 10×, unverified tokens, first ascents.", ely: "Ely holds on." },
];

function Slope({ band, label }: { readonly band: GradeBand; readonly label: string }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintSlope(ctx, band, info.seconds, info.still), [band]);
  return <PixelCanvas width={SLOPE_W} height={SLOPE_H} scale={4} draw={draw} animate fps={8} label={label} />;
}

/** The route grades every action carries (SAC T1-T6, painted as trail blazes), each as a slope Ely climbs. */
export function Grades() {
  return (
    <Section id="grades" tag="Route grades · T1 to T6" title="Every move is graded." lede="The blaze sits on the button, so you know the terrain before you sign. The Rule Book grades the real plan; the steeper the grade, the more it asks of you.">
      <Cards n={3} as="ul">
        {GRADES.map((grade) => (
          <li key={grade.name} className="flex h-full flex-col items-center gap-3 bg-card px-5 pb-6 pt-6 text-center px-frame px-drop">
            <Slope band={grade.band} label={`${grade.name} slope: ${grade.ely}`} />
            <span className="mt-2 inline-flex items-center gap-2 font-tag text-[12px] uppercase text-ink-2">
              <Blaze grade={grade.grades[0]} size={18} label={null} />T{grade.grades[0]}–T{grade.grades[1]}
            </span>
            <h3 className="font-display text-[26px] font-bold leading-none text-ink">{grade.name}</h3>
            <p className="text-[14px] leading-snug text-ink-2">{grade.body}</p>
            <p className="mt-auto font-tag text-[11px] uppercase text-summit-ink">{grade.ely}</p>
          </li>
        ))}
      </Cards>
    </Section>
  );
}
