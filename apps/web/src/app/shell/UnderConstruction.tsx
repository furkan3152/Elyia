import { ArrowLeft, type LucideIcon } from "lucide-react";

import { openOracle } from "../../oracle/oracleStore";
import { Badge, Chip, Tag } from "../../ui/Badge";
import { Button, ButtonLink } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { routeHref } from "../routes/routeTable";
import { Page } from "./Page";

export interface UnderConstructionProps {
  readonly icon: LucideIcon;
  readonly title: string;
  /** Gold caps line ("HYPERCORE TERMINAL"). */
  readonly eyebrow: string;
  /** What this surface is for, in one or two sentences. */
  readonly description: string;
  /** What the next build adds here. */
  readonly planned: readonly string[];
  /** An intent that already works in the Oracle for this surface. */
  readonly example?: string;
  /** "site" pages render without the deck's Page container. */
  readonly variant?: "app" | "site";
}

/**
 * Placeholder for a surface that a later build fills. It renders inside the
 * shell, says that the page is under construction in this build,
 * lists what is coming and offers what already works (the Oracle, the deck,
 * the live pulse). It never pretends to show data.
 */
export function UnderConstruction({ icon: Icon, title, eyebrow, description, planned, example, variant = "app" }: UnderConstructionProps) {
  const body = (
    <Panel variant="sheet" padding="lg" className="mx-auto max-w-3xl overflow-hidden" fold>
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tag icon={<Icon className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />}>{eyebrow}</Tag>
          <Badge tone="signal" variant="solid">
            Being surveyed in this build
          </Badge>
        </div>
        <div>
          <h1 className="font-display text-[36px] font-bold leading-[1.05] text-ink sm:text-[44px]">{title}</h1>
          <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-ink-2 text-pretty">{description}</p>
        </div>
        <div>
          <p className="caption mb-3">Arriving on this sheet next</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {planned.map((item) => (
              <li key={item} className="flex items-start gap-2.5 bg-paper/50 px-3 py-2.5 text-sm text-ink px-frame-thin">
                <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 bg-summit" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        {example ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="caption">Already speaks</span>
            <Chip mono onClick={() => openOracle(example)}>
              <span aria-hidden="true" className="font-semibold text-summit-ink">
                →
              </span>
              “{example}”
            </Chip>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-4 border-t-2 border-dashed border-rule pt-6">
          <Button variant="primary" onClick={() => openOracle(example)}>
            Where to?
          </Button>
          <ButtonLink to={routeHref("deck")} variant="ink" leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
            Back to the deck
          </ButtonLink>
          <ButtonLink to={routeHref("elysium")} variant="ghost">
            Watch the barograph
          </ButtonLink>
        </div>
      </div>
    </Panel>
  );
  if (variant === "site") return <div className="mx-auto max-w-[1280px] px-4 pb-20 pt-10 sm:px-8 lg:px-10">{body}</div>;
  return <Page className="pt-6 sm:pt-10">{body}</Page>;
}
