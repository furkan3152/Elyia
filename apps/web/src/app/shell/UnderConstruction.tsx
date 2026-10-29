import { ArrowLeft, CircleDot, Sparkles, type LucideIcon } from "lucide-react";

import { openOracle } from "../../oracle/oracleStore";
import { Badge, Chip } from "../../ui/Badge";
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
    <Panel variant="glow" padding="lg" className="mx-auto max-w-3xl overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgb(var(--gold)/0.16),transparent)]" />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-glow/30 bg-violet/[0.12] text-violet-soft">
            <Icon className="h-6 w-6" aria-hidden="true" strokeWidth={1.6} />
          </span>
          <Badge tone="gold" dot>
            Under construction in this build
          </Badge>
        </div>
        <div>
          <p className="eyebrow mb-2">{eyebrow}</p>
          <h1 className="font-display text-display-md text-text-0">{title}</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-text-1 text-pretty">{description}</p>
        </div>
        <div>
          <p className="label-caps mb-3">Arriving here next</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {planned.map((item) => (
              <li key={item} className="flex items-start gap-2.5 rounded-xl border border-line bg-bg-0/30 px-3 py-2.5 text-sm text-text-1">
                <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        {example ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-2">Already speaks:</span>
            <Chip tone="gold" mono onClick={() => openOracle(example)}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {example}
            </Chip>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <ButtonLink to={routeHref("deck")} variant="outline" leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
            Back to the deck
          </ButtonLink>
          <Button variant="gold" onClick={() => openOracle(example)} leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
            Speak your intent
          </Button>
          <ButtonLink to={routeHref("elysium")} variant="ghost">
            Watch the Elysium pulse
          </ButtonLink>
        </div>
      </div>
    </Panel>
  );
  if (variant === "site") return <div className="mx-auto max-w-[1280px] px-4 pb-20 pt-6 sm:px-8 lg:px-10">{body}</div>;
  return <Page className="pt-6 sm:pt-10">{body}</Page>;
}
