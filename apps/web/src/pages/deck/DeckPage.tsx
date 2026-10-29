import { Bot, ChartCandlestick, Route } from "lucide-react";

import { Page } from "../../app/shell/Page";
import { routeHref } from "../../app/routes/routeTable";
import { useSearchParam } from "../../app/routes/useRoute";
import { ButtonLink } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Panel, PanelHeader } from "../../ui/Panel";
import { MarketsLyre } from "../../visuals/lyre/MarketsLyre";
import { IntentInbox } from "./IntentInbox";
import { NetWorthCard } from "./NetWorthCard";
import { PulseCard } from "./PulseCard";

/**
 * "/app" — the Deck v1. A layout grid whose cards later builds fill: net
 * worth (portfolio), the Lyre (positions; markets while flat), the mini Sun,
 * positions (trade), the agent feed (agent) and what is in flight (track).
 */
export default function DeckPage() {
  const intent = useSearchParam("intent");
  return (
    <Page>
      <h1 className="sr-only">Deck</h1>
      <div className="grid gap-4 xl:grid-cols-12">
        {intent ? (
          <div className="xl:col-span-12">
            <IntentInbox sentence={intent.slice(0, 500)} />
          </div>
        ) : null}
        <div className="xl:col-span-5">
          <NetWorthCard />
        </div>
        <div className="xl:col-span-4">
          <Panel padding="lg" className="h-full rounded-3xl">
            <PanelHeader title="The Lyre" aside={<span>7 hottest markets</span>} />
            <MarketsLyre height={250} />
          </Panel>
        </div>
        <div className="xl:col-span-3">
          <PulseCard />
        </div>

        <div className="xl:col-span-5">
          <Panel padding="lg" className="h-full rounded-3xl">
            <PanelHeader
              title="Positions · HyperCore"
              aside={
                <ButtonLink to={routeHref("trade")} variant="ghost" size="xs">
                  Open terminal
                </ButtonLink>
              }
            />
            <EmptyState
              icon={<ChartCandlestick className="h-5 w-5" aria-hidden="true" />}
              title="No positions yet"
              description="Your HyperCore perps appear here with PnL and liquidation distance. Say a trade to open one."
              example="long ETH 5x with 200 USDC, stop at -3%"
            />
          </Panel>
        </div>
        <div className="xl:col-span-4">
          <Panel padding="lg" className="h-full rounded-3xl">
            <PanelHeader title="Elysium agent · feed" aside={<span>propose mode</span>} />
            <EmptyState
              icon={<Bot className="h-5 w-5" aria-hidden="true" />}
              title="The agent is listening"
              description="Proposals, guard actions and briefings land here. It can trade inside your Rule Book, never withdraw."
              example="every day buy 10 HYPE"
            />
          </Panel>
        </div>
        <div className="xl:col-span-3">
          <Panel padding="lg" className="h-full rounded-3xl">
            <PanelHeader title="In flight" />
            <EmptyState
              compact
              icon={<Route className="h-5 w-5" aria-hidden="true" />}
              title="Nothing moving"
              description="Bridges, swaps and TWAPs show each step here until final."
              example="bridge 20 HYPE to Elysium"
            />
          </Panel>
        </div>
      </div>
    </Page>
  );
}
