import { Ely } from "../../pixel/Ely";
import { Cards, Section } from "../../pixel/layout";
import { STATE_MEANING, type ElyState } from "../../pixel/states";

const STATES: readonly ElyState[] = ["idle", "climb", "summit", "worry", "sleep", "watch"];

/** Six sprites, six meanings: the state reads before the number does. */
export function StatesStrip() {
  return (
    <Section id="states" tag="Ely · the pixel ibex" title="Ely says the state." lede="Loading, proven, at risk, empty, on watch: every moment that matters in Elyia has a sprite, so you read the state before the number.">
      <Cards n={6} as="ul">
        {STATES.map((state) => {
          const meaning = STATE_MEANING[state];
          return (
            <li key={state} className="flex h-full flex-col items-center bg-card px-3 pb-5 pt-4 text-center px-frame px-drop">
              <Ely state={state} size={104} label={null} />
              <h3 className="mt-3 font-display text-[19px] font-bold leading-tight text-ink">{meaning.title}</h3>
              <p className="mt-1 text-[12px] leading-snug text-ink-2">{meaning.detail}</p>
              <p className="mt-auto pt-3 font-tag text-[10px] uppercase leading-snug text-summit-ink">{meaning.where}</p>
            </li>
          );
        })}
      </Cards>
    </Section>
  );
}
