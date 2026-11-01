import "../../features/ely/ely.css";

import { useMemo } from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../app/routes/routeTable";
import { useRouteParam } from "../../app/routes/useRoute";
import { WalletButton } from "../../app/shell/WalletButton";
import { useAutomations, useInsights } from "../../features/ely/agentApi";
import { useMediaQuery } from "../../features/ely/hooks";
import { useElySession } from "../../features/ely/session";
import { Glyph } from "../../features/ely/ui";
import { describeError } from "../../lib/api";
import { ElyLoader } from "../../pixel/ElyLoader";
import { Page, Section } from "../../pixel/layout";
import { WatchField } from "./parts/WatchField";
import { pct, shortAddr, usdShort } from "./range/format";
import { dayChange } from "./range/labels";
import { EXAMPLE_ADDRESS } from "./range/sample";
import { useRange } from "./range/useRange";
import { AutomationShelf } from "./v2/Automations";
import { Hero, type HeroPill } from "./v2/Hero";
import { Insights } from "./v2/Insights";
import { PnlExplain } from "./v2/PnlExplain";
import { SAMPLE_INSIGHTS, SAMPLE_PNL } from "./v2/sample";
import { TerrainWhatIf } from "./v2/TerrainWhatIf";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

/**
 * "/app/portfolio/:address?": Portfolio × Ely. The altimeter hero; the
 * range (terrain with What-if) beside Ely's insights, each a draft one tap
 * from the real sign flow; the automations shelf (drafts only, or the opt-in
 * keeper inside caps the wallet signs); Explain my PnL (chat | waterfall);
 * and the trust row. Without a wallet it teaches with a labelled sample.
 */
export default function PortfolioPage() {
  const param = useRouteParam("address");
  const { address: connected } = useAccount();
  const invalid = param !== undefined && !ADDRESS.test(param);
  const followed = invalid ? null : (param?.toLowerCase() ?? connected?.toLowerCase() ?? null);
  const own = followed !== null && connected !== undefined && followed === connected.toLowerCase();
  const range = useRange(followed);
  const sample = range.source === "sample";
  const session = useElySession();
  const insights = useInsights(sample ? null : followed);
  const automations = useAutomations(own ? session.token : null);
  const phone = !useMediaQuery("(min-width: 768px)", true);

  const insightList = sample || (insights.isError && !insights.data) ? SAMPLE_INSIGHTS : (insights.data?.insights ?? []);
  const insightsSample = sample || (insights.isError && !insights.data);
  const pnl = sample ? SAMPLE_PNL : (insights.data?.insights.find((insight) => insight.kind === "explain-pnl")?.figures ?? null);

  const snapshot = range.snapshot;
  const pills = useMemo<HeroPill[]>(() => {
    if (!snapshot) return [];
    const out: HeroPill[] = [];
    const change = dayChange(range.history);
    const worth = snapshot.totals.netWorthUsd;
    if (change !== null) out.push({ tone: change >= 0 ? "up" : "dn", text: `${change >= 0 ? "▲" : "▼"} ${usdShort(Math.abs(change))}${worth > 0 ? ` · ${pct(Math.abs(change) / Math.max(1, worth - change))}` : ""} today` });
    const layers = snapshot.layers.filter((layer) => layer.lines.some((line) => Number(line.amount) !== 0)).length;
    const holdings = snapshot.layers.reduce((sum, layer) => sum + layer.lines.filter((line) => (line.usd ?? 0) >= 1).length, 0) + snapshot.positions.length;
    out.push({ tone: "mute", text: `${holdings} peaks · ${layers} layer${layers === 1 ? "" : "s"}` });
    const fraying = range.ropes.filter((rope) => rope.distance !== null && rope.distance < 0.1).length;
    out.push(fraying > 0 ? { tone: "dn", text: `▼ ${fraying} rope${fraying === 1 ? "" : "s"} under 10%` } : { tone: "up", text: range.ropes.length > 0 ? "▲ every rope over 10%" : "no open ropes" });
    const on = automations.data?.automations.filter((automation) => automation.enabled).length;
    if (on !== undefined) out.push({ tone: "acc", text: `${on} automation${on === 1 ? "" : "s"} on` });
    if (sample) out.push({ tone: "sig", text: "Sample range · labelled" });
    else if (range.mode === "testnet") out.push({ tone: "sig", text: "Testnet prices · labelled" });
    return out;
  }, [snapshot, range.history, range.ropes, range.mode, automations.data, sample]);

  const tag = `Portfolio · ${sample ? "sample range" : own ? "your range" : "watching"}${followed ? ` · ${shortAddr(followed)}` : ""}`;

  return (
    <div className="ely2">
      <Page>
        {invalid ? (
          <p role="alert" className="mx-auto mt-8 max-w-[720px] bg-card px-4 py-3 text-center text-sm text-down px-frame px-tone-down">
            “{param.slice(0, 64)}” is not an address. Showing the sample range; paste 0x followed by 40 hex characters.
          </p>
        ) : null}
        {snapshot ? (
          <Hero tag={tag} value={snapshot.totals.netWorthUsd} pills={pills} />
        ) : (
          <div className="flex min-h-[220px] items-center justify-center" aria-busy="true">
            <ElyLoader label="Surveying the range" size="lg" />
          </div>
        )}
        {sample ? (
          <div className="mx-auto mt-6 flex w-full max-w-[720px] flex-col items-stretch gap-4 sm:flex-row sm:items-start">
            <WatchField hrefFor={(address) => routeHref("portfolio", { address })} example={EXAMPLE_ADDRESS} className="min-w-0 flex-1" />
            <WalletButton />
          </div>
        ) : null}
        {range.source === "browser" ? (
          <p className="mx-auto mt-6 max-w-[720px] bg-paper-2 px-4 py-3 text-center text-[13px] text-ink-2 px-frame-thin">
            <span className="font-semibold text-ink">The Elyia survey is not answering</span> ({range.apiProblem}). The range is read in your browser; Ely&apos;s insights show a labelled sample until it is back.
          </p>
        ) : null}

        <Section seam={false} className="!pt-10">
          {snapshot ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <TerrainWhatIf snapshot={snapshot} ropes={range.ropes} sample={sample} phone={phone} />
              <Insights insights={insightList} sample={insightsSample} loading={!sample && insights.isPending} error={!sample && insights.isError ? describeError(insights.error) : null} />
            </div>
          ) : null}
        </Section>

        <Section id="automations" tag="Automations · bounded by your caps" title="Ely keeps watch. You keep the keys." lede="Each automation drafts proposals you sign. If you want Ely to act, sign a policy once: reduce-only, a per-order and a daily cap, an expiry. Revoke it in one tap. Ely can never withdraw to anyone but you.">
          <AutomationShelf session={session} own={own} />
        </Section>

        <Section id="pnl" tag="Explain my PnL" title="Ask why. Get the ledger." lede="No other screen tells you where the money went. Ely reads your fills, funding and fees and answers with the numbers.">
          <PnlExplain figures={pnl} address={sample ? null : followed} session={own ? session.token : null} sample={sample || !pnl} phone={phone} />
        </Section>

        <Section className="!pb-16">
          <ul className="grid grid-cols-1 gap-6 md:grid-cols-3" aria-label="How Ely is bounded">
            {(
              [
                ["wallet", "Your wallet signs", "Ely drafts; nothing moves without you."],
                ["shield", "Caps on every power", "Allowlist, daily cap, expiry, revoke."],
                ["anchor", "Ely never withdraws", "Funds only ever return to you."],
              ] as const
            ).map(([glyph, title, line]) => (
              <li key={title} className="fr flex items-center gap-3.5 p-5">
                <Glyph name={glyph} scale={3} />
                <div>
                  <b className="disp block text-[16px]">{title}</b>
                  <span className="text-[12px] text-ink-2">{line}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </Page>
    </div>
  );
}
