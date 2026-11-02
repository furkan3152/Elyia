/**
 * Admin → Herd: the whole mint, run from the owner's wallet. Every on-chain
 * change is calldata the API prepares (guards, eth_call, audit log) and the
 * owner's wallet signs; WL work (tasks, queue, raffle, lists, exports) is
 * server state, also audit-logged.
 */
import type { HerdConfigResponse, HerdListId } from "@elyia/core/api/herd";
import { HERD_BUCKETS } from "@elyia/core/api/herd";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { downloadExport, useHerdAdmin, useHerdAudit, useHerdDashboard, useHerdOverview, type HerdOverview } from "../../../features/herd/herdApi";
import { allocationProblem, formatHype, formatUsd6, parseHype, parseWalletList, partnerTagProblem, PHASE_INDEX, PHASE_LABEL, short, timeline, toLocalInput, unixSeconds, withdrawOptions } from "../../../features/herd/herdModel";
import { describeError } from "../../../lib/api";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { toast } from "../../../ui/toast";
import { Card, CardHead, KV, Pill, SectionHead, Stat } from "../../developers/portal/ui";
import { useContractsConfig, useDeployPlan } from "../adminApi";
import { ContractCard, DeployFlow } from "../ContractsSection";
import { recordedOn } from "../contracts";
import { useDeploy } from "../useDeploy";
import { AreaField, SelectField, TextField } from "./fields";
import { HerdTx } from "./HerdTx";
import { HerdQueue } from "./HerdQueue";

const ZERO = /^0x0{40}$/iu;
const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/u.test(value.trim());

function Section({ id, tag, title, lede, children }: { readonly id: string; readonly tag: string; readonly title: string; readonly lede?: React.ReactNode; readonly children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14 first:mt-0 first:border-t-0 first:pt-12">
      <SectionHead id={`${id}-title`} tag={tag} title={title} lede={lede} />
      {children}
    </section>
  );
}

function notDeployed(config: HerdConfigResponse | undefined): string | null {
  if (!config) return "Loading the collection…";
  if (config.source === "not-deployed") return "Deploy and record ElyHerd first.";
  if (config.source === "chain-error") return config.note ?? "The contract does not answer right now.";
  return null;
}

/* ------------------------------------------------------------ overview */

function Overview({ overview, owner }: { readonly overview: HerdOverview | undefined; readonly owner: string }) {
  const config = overview?.config;
  const admin = config?.admin;
  const { address } = useAccount();
  const notOwner = admin?.owner && address && admin.owner !== address.toLowerCase();
  const stats = [
    { label: "Minted", value: config?.totalSupply ?? "—", note: `of ${config?.admin?.maxMintable ?? config?.maxSupply ?? 3333}` },
    { label: "Phase", value: config?.phase ? PHASE_LABEL[config.phase] : config?.source === "not-deployed" ? "—" : "?", note: config?.paused ? "PAUSED" : config?.open.wl || config?.open.public ? "window open" : "window closed" },
    { label: "Applications", value: overview?.counts.total ?? "—", note: `${overview?.counts.pending ?? 0} pending · ${overview?.counts.approved ?? 0} approved` },
    { label: "Contract balance", value: admin?.balanceWei ? formatHype(admin.balanceWei) : "—", note: "withdraw to owner or treasury" },
  ];
  return (
    <Section id="herd" tag={`The Herd · ElyHerd${config?.testnet ? " · Testnet" : ""}`} title="Run the mint from your wallet." lede="Phases, prices, lists, reveal and funds: the API prepares each call and checks it; your wallet signs it. WL tasks, the queue, raffles and exports are logged in the audit log.">
      {config?.testnet ? (
        <p className="mb-6 text-center">
          <Pill tone="warn" dot>
            Testnet · test HYPE, fixed 3 HYPE price
          </Pill>
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Stat key={stat.label} label={stat.label} value={stat.value} note={stat.note} />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="star" title="Contract" right={config?.source === "chain" ? <Pill tone="up" dot>live</Pill> : <Pill tone="mute">{config?.source ?? "…"}</Pill>} />
          <KV
            rows={[
              ["Address", config?.address ? <span key="a" className="font-mono">{short(config.address)}</span> : "not deployed"],
              ["Owner", admin?.owner ? <span key="o" className={cx("font-mono", notOwner && "text-warn-ink")}>{short(admin.owner)}{notOwner ? " · not this wallet" : admin.owner === owner ? " · you" : ""}</span> : "—"],
              ["Pending owner", admin?.pendingOwner ? short(admin.pendingOwner) : "none"],
              ["Treasury", admin?.treasury ? <span key="t" className="font-mono">{short(admin.treasury)}</span> : config?.links.treasury ? `${short(config.links.treasury)} (config)` : <span key="t" className="text-warn-ink">not configured</span>],
              ["Royalty", config?.royalty.bps !== null && config?.royalty.bps !== undefined ? `${(config.royalty.bps / 100).toFixed(1)}% → ${short(config.royalty.receiver)}` : "—"],
              ["EOA-only public", admin?.eoaOnly === null || admin?.eoaOnly === undefined ? "—" : admin.eoaOnly ? "on" : "off"],
              ["Indexer", overview?.index ? `block ${overview.index.next.toLocaleString("en-US")}${overview.index.lastError ? ` · ${overview.index.lastError}` : ""}` : "idle"],
            ]}
          />
        </Card>
        <KalosChecklist config={config} />
      </div>
      <OwnerInputs config={config} xApi={overview?.xApi ?? false} />
    </Section>
  );
}

/** Kalos listing is not automatic: a Kalos admin registers the collection and sets the creator fee. */
function KalosChecklist({ config }: { readonly config: HerdConfigResponse | undefined }) {
  const deployed = config?.source === "chain";
  const items: readonly (readonly [boolean | null, string])[] = [
    [deployed, "ElyHerd deployed and recorded (ERC-721, ERC-2981, EIP-4906 interfaces)"],
    [Boolean(config?.admin?.contractURI), "contractURI set (collection name, image, links for Kalos and wallets)"],
    [Boolean(config?.admin?.placeholderURI), "placeholderURI set (pre-reveal metadata)"],
    [null, "Send Kalos the address: their admin calls setCollectionApprovalStatus(collection, 1, Kalos WHYPE, 0)"],
    [null, "Ask Kalos for the creator fee: setCollectionCreatorFee(collection, (500 bps, treasury)); ERC-2981 is not read by the marketplace"],
    [Boolean(config?.links.marketplace), "HERD_MARKETPLACE_URL set once the collection page is live"],
  ];
  return (
    <Card className="flex flex-col gap-3">
      <CardHead glyph="flag" title="Kalos listing request" right={<Pill tone="mute">manual · Kalos admin</Pill>} />
      <p className="text-[12px] text-ink-2">Kalos lists a collection only after a Kalos admin registers it; there is no self-serve registry. Royalties there are a creator fee their admin sets.</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">
        {items.map(([done, text]) => (
          <li key={text} className="flex gap-2">
            <span aria-hidden="true" className={cx("mt-1 inline-block h-[8px] w-[8px] shrink-0", done === true ? "bg-up" : done === false ? "bg-rule-strong" : "bg-signal")} />
            <span className={done === true ? "text-ink-2 line-through decoration-ink-3" : "text-ink"}>
              {text}
              <span className="sr-only">{done === true ? " (done)" : done === false ? " (to do)" : " (ask Kalos)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OwnerInputs({ config, xApi }: { readonly config: HerdConfigResponse | undefined; readonly xApi: boolean }) {
  const links = config?.links;
  const missing = (value: unknown) => (value ? <span className="text-up">set</span> : <span className="text-warn-ink">not configured</span>);
  return (
    <Card flat className="mt-6">
      <CardHead glyph="docs" title="Owner inputs (server config)" right={<Pill tone="mute">env · never invented</Pill>} />
      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <KV
          rows={[
            ["Admin wallets", "ELYIA_ADMIN_ADDRESSES · set (you are in)"],
            ["X profile", <span key="x">HERD_X_PROFILE_URL · {missing(links?.xProfile)}</span>],
            ["Engagement posts", <span key="p">HERD_ENGAGEMENT_POST_URLS · {links?.engagementPosts.length ? `${links.engagementPosts.length} set` : missing(null)}</span>],
          ]}
        />
        <KV
          rows={[
            ["Treasury", <span key="t">HERD_TREASURY_ADDRESS · {missing(links?.treasury)}</span>],
            ["Mainnet launch", <span key="m">HERD_MAINNET_LAUNCH · {links?.mainnetLaunch ? links.mainnetLaunch.slice(0, 10) : missing(null)}</span>],
            ["X API", <span key="a">X_API_BEARER (optional) · {xApi ? <span className="text-up">set: x-api tasks verify</span> : "not set: tasks reviewed by hand"}</span>],
          ]}
        />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- deploy */

function DeployHerd({ owner }: { readonly owner: string }) {
  const network = "elysium-testnet" as const;
  const config = useContractsConfig(true);
  const plan = useDeployPlan(network, true);
  const recorded = useMemo(() => recordedOn(config.data, network), [config.data]);
  const herdConfig = useHerdOverview(true).data?.config;
  const [ownerInput, setOwnerInput] = useState(owner);
  const [treasury, setTreasury] = useState("");
  const treasuryValue = treasury || herdConfig?.links.treasury || "";
  const params = useMemo(() => ({ owner: ownerInput, treasury: treasuryValue }), [ownerInput, treasuryValue]);
  const deploy = useDeploy("ElyHerd", network, recorded, plan.data, params);
  const recordedAt = recorded.ElyHerd ?? null;
  return (
    <>
      <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2" id="herd-contract">
        <ContractCard contract="ElyHerd" network={network} config={config.data} record={undefined} flow={deploy.state} selected={!recordedAt} onDeploy={() => document.getElementById("herd-deploy")?.scrollIntoView({ block: "start" })} />
        <Card className="flex flex-col gap-3">
          <CardHead glyph="docs" title="Constructor (manifest · collections.herd)" right={<Pill tone="mute">you confirm</Pill>} />
          <p className="text-[12px] text-ink-2">Name The Herd, symbol HERD, testnet price 3 HYPE (WL and public), allocations team 111 · WL 1611 · collab 0 · public 1611. The owner and treasury are yours to enter; nothing is guessed.</p>
          <KV rows={[["WHYPE", "canonical, from the manifest"], ["USDC", "canonical, from the manifest"], ["After deploy", "provenance, placeholder URI, contract URI, roots, windows (below)"]]} />
        </Card>
      </div>
      <DeployFlow
        sectionId="herd-deploy"
        contract="ElyHerd"
        network={network}
        state={deploy.state}
        walletAddress={deploy.address}
        walletChainId={deploy.walletChainId}
        nativeSymbol="HYPE"
        recordedAt={recordedAt}
        onPreview={() => void deploy.preview()}
        onSign={() => {
          const current = "preview" in deploy.state ? deploy.state.preview : null;
          if (current) void deploy.sign(current);
        }}
        onReset={deploy.reset}
        inputs={
          <div className="flex flex-col gap-3">
            <TextField label="Owner (admin wallet)" value={ownerInput} onChange={setOwnerInput} hint={isAddress(ownerInput) ? "Suggested: your connected wallet. Confirm it is the admin wallet." : "Enter a 0x address."} />
            <TextField label="Treasury" value={treasuryValue} onChange={setTreasury} placeholder="0x… (the owner provides it)" hint={herdConfig?.links.treasury ? "From HERD_TREASURY_ADDRESS." : "Not configured on the server: enter the owner's treasury."} />
          </div>
        }
      />
    </>
  );
}

/* -------------------------------------------------------------- phases */

function Phases({ config }: { readonly config: HerdConfigResponse | undefined }) {
  const blocked = notDeployed(config);
  const current = config?.phase ? PHASE_INDEX[config.phase] : 0;
  const next = (["wl", "public", "ended"] as const).find((phase) => PHASE_INDEX[phase] > current) ?? null;
  return (
    <Section id="herd-phases" tag="Phases · windows · prices" title="Closed → WL → Public → Ended." lede="Phases only move forward. Each mint phase has a window (UTC) and a price; you can extend, shorten or reprice at any time. Pausing is separate (Operations).">
      <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-4">
        {timeline(config).map((stop) => (
          <li key={stop.phase} className={cx("flex flex-col gap-1 p-3 px-frame-thin", stop.state === "now" ? "bg-accent/15" : stop.state === "done" ? "bg-paper-2" : "bg-card")}>
            <span className="font-tag text-[10px] uppercase text-ink-3">{stop.state === "now" ? "now" : stop.state}</span>
            <b className="font-display text-[16px] text-ink">{stop.label}</b>
            <span className="text-[11.5px] text-ink-2">{stop.start ? `${stop.start.slice(0, 16).replace("T", " ")} → ${stop.end?.slice(0, 16).replace("T", " ")}` : stop.phase === "wl" || stop.phase === "public" ? "no window" : "—"}</span>
            {stop.price ? <span className="font-mono text-[11.5px] text-ink">{stop.price}</span> : null}
          </li>
        ))}
      </ol>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="flag" title="Move the phase" />
          <p className="text-[12px] text-ink-2">Now: <b>{config?.phase ? PHASE_LABEL[config.phase] : "—"}</b>. {next ? `Next: ${PHASE_LABEL[next]}.` : "The mint has ended."} Opening WL or Public needs the provenance hash and locks setAllocations.</p>
          {next ? <HerdTx label={`Prepare setPhase(${PHASE_LABEL[next]})`} functionName="setPhase" args={[String(PHASE_INDEX[next])]} disabled={blocked} confirm={next === "ended" ? "END" : undefined} /> : null}
        </Card>
        <WindowCard phase="wl" config={config} blocked={blocked} />
        <WindowCard phase="public" config={config} blocked={blocked} />
      </div>
    </Section>
  );
}

function WindowCard({ phase, config, blocked }: { readonly phase: "wl" | "public"; readonly config: HerdConfigResponse | undefined; readonly blocked: string | null }) {
  const window = config?.timeline.find((entry) => entry.phase === phase);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [price, setPrice] = useState<string | null>(null);
  const [usd, setUsd] = useState<string | null>(null);
  const startValue = start ?? toLocalInput(window?.start ?? null);
  const endValue = end ?? toLocalInput(window?.end ?? null);
  const modeValue = mode ?? (window?.priceMode === "usd" ? "1" : "0");
  const priceValue = price ?? (window ? String(Number(window.priceWei) / 1e18) : "3");
  const usdValue = usd ?? (window && window.priceUsd6 !== "0" ? String(Number(window.priceUsd6) / 1e6) : "2");
  const s = unixSeconds(startValue);
  const e = unixSeconds(endValue);
  const wei = parseHype(priceValue);
  const usd6 = /^\d{1,6}(?:\.\d{1,6})?$/u.test(usdValue) ? Math.round(Number(usdValue) * 1e6) : null;
  const args = s === null || e === null ? "Pick the start and end (UTC)." : e <= s ? "The window must end after it starts." : wei === null ? "Enter the price in HYPE." : modeValue === "1" && !usd6 ? "Enter the USD price." : [String(PHASE_INDEX[phase]), String(s), String(e), modeValue, wei.toString(), String(modeValue === "1" ? usd6 : 0)];
  return (
    <Card className="flex flex-col gap-3">
      <CardHead glyph="clock" title={`${PHASE_LABEL[phase]} window`} right={<Pill tone="mute">{window?.start ? "set" : "not set"}</Pill>} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Start (UTC)" type="datetime-local" value={startValue} onChange={setStart} />
        <TextField label="End (UTC)" type="datetime-local" value={endValue} onChange={setEnd} />
        <SelectField label="Price mode" value={modeValue} onChange={setMode} options={[["0", "Fixed HYPE"], ["1", "USD-pegged"]]} />
        {modeValue === "1" ? <TextField label="USD price" value={usdValue} onChange={setUsd} hint="Mainnet: $2" /> : <TextField label="Price (HYPE)" value={priceValue} onChange={setPrice} hint="Testnet: 3 HYPE; WL may be 0" />}
      </div>
      <HerdTx label="Prepare setPhaseConfig" functionName="setPhaseConfig" args={args} disabled={blocked} />
    </Card>
  );
}

/* --------------------------------------------------------------- price */

function Price({ config }: { readonly config: HerdConfigResponse | undefined }) {
  const blocked = notDeployed(config);
  const oracle = config?.admin?.oracle;
  const [pool, setPool] = useState("");
  const [twap, setTwap] = useState("1800");
  const [deviation, setDeviation] = useState("500");
  const [cardinality, setCardinality] = useState("200");
  const [usdPerHype, setUsdPerHype] = useState("");
  const [staleness, setStaleness] = useState("86400");
  const fallback6 = /^\d{1,9}(?:\.\d{1,6})?$/u.test(usdPerHype) ? String(Math.round(Number(usdPerHype) * 1e6)) : null;
  return (
    <Section id="herd-price" tag="Price oracle" title="USD peg, failing closed." lede="Mainnet prices $2 in HYPE from a Kalos V3 WHYPE/USDC TWAP, with your fallback price inside a staleness window. A bad or missing price reverts the mint. Testnet uses the fixed 3 HYPE.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="pulse" title="State" right={config?.quotes.some((quote) => quote.source === "unavailable") ? <Pill tone="dn" dot>oracle down</Pill> : <Pill tone="up" dot>quoting</Pill>} />
          <KV
            rows={[
              ["TWAP pool", oracle?.pool ? short(oracle.pool) : "none"],
              ["Window", oracle?.pool ? `${oracle.twapSeconds} s · max dev ${oracle.maxDeviationBps} bps` : "—"],
              ["Fallback", oracle && oracle.fallbackUsdPerHype6 !== "0" ? `${formatUsd6(oracle.fallbackUsdPerHype6)}/HYPE · ${oracle.fallbackStale ? "stale" : "fresh"}` : "off"],
              ["WL quote", config?.quotes.find((quote) => quote.phase === "wl")?.wei ? `${formatHype(config.quotes.find((quote) => quote.phase === "wl")!.wei)} (${config.quotes.find((quote) => quote.phase === "wl")!.source})` : "unavailable"],
              ["Public quote", config?.quotes.find((quote) => quote.phase === "public")?.wei ? `${formatHype(config.quotes.find((quote) => quote.phase === "public")!.wei)} (${config.quotes.find((quote) => quote.phase === "public")!.source})` : "unavailable"],
            ]}
          />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="peak" title="TWAP oracle" />
          <TextField label="Pool (WHYPE/USDC)" value={pool} onChange={setPool} placeholder="0x… Kalos V3 pool" hint="0x000…000 disables the TWAP." />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="TWAP seconds" value={twap} onChange={setTwap} />
            <TextField label="Max deviation bps" value={deviation} onChange={setDeviation} />
          </div>
          <HerdTx label="Prepare setOracle" functionName="setOracle" args={isAddress(pool) ? [pool.trim(), twap, deviation] : "Enter the pool address."} disabled={blocked} />
          <TextField label="Observation cardinality" value={cardinality} onChange={setCardinality} hint="Kalos pools ship with 1: grow it before relying on the TWAP." />
          <HerdTx label="Prepare growOracleCardinality" functionName="growOracleCardinality" args={[cardinality]} disabled={blocked ?? (oracle?.pool ? null : "Set the oracle pool first.")} variant="ink" />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="shield" title="Fallback price" />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="USD per HYPE" value={usdPerHype} onChange={setUsdPerHype} placeholder="e.g. 41.25" hint="0 disables it." />
            <TextField label="Max staleness (s)" value={staleness} onChange={setStaleness} hint="≤ 7 days" />
          </div>
          <HerdTx label="Prepare setFallbackPrice" functionName="setFallbackPrice" args={fallback6 ? [fallback6, staleness] : "Enter the USD price of 1 HYPE."} disabled={blocked} />
        </Card>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- supply */

function Supply({ overview }: { readonly overview: HerdOverview | undefined }) {
  const config = overview?.config;
  const blocked = notDeployed(config);
  const a = config?.allocations;
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const draft = values ?? { team: String(a?.team ?? 111), wl: String(a?.wl ?? 1611), collab: String(a?.collab ?? 0), public: String(a?.public ?? 1611) };
  const numbers = { team: Number(draft.team), wl: Number(draft.wl), collab: Number(draft.collab), public: Number(draft.public) };
  const problem = allocationProblem(numbers, config?.maxSupply ?? 3333, a?.burned ?? 0);
  const locked = config?.phase && config.phase !== "closed" ? "Locked: a phase opened. Use rollover." : null;
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("3");
  const [qty, setQty] = useState("");
  const rows = a
    ? ([["Team", a.team, a.teamMinted], ["WL", a.wl, a.wlMinted], ["Collab", a.collab, a.collabMinted], ["Public", a.public, a.publicMinted]] as const)
    : ([["Team", 111, 0], ["WL", 1611, 0], ["Collab", 0, 0], ["Public", 1611, 0]] as const);
  return (
    <Section id="herd-supply" tag="Allocations · rollover · partners" title="Every goat has a bucket." lede="Team, WL, collab and public caps sum to at most 3,333. Leftovers move by explicit rollover: WL/collab into public from the Public phase, public into team or burn once Ended.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="grid" title="Buckets" right={a ? <Pill tone="up">live</Pill> : <Pill tone="mute">planned</Pill>} />
          <KV rows={rows.map(([name, cap, minted]) => [name, <span key={name} className="font-mono tnum">{minted} / {cap} · {cap - minted} left</span>])} />
          {a?.burned ? <p className="text-[11.5px] text-ink-3">{a.burned} burned for good.</p> : null}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="percent" title="Set allocations" />
          <div className="grid grid-cols-2 gap-2">
            {(["team", "wl", "collab", "public"] as const).map((key) => (
              <TextField key={key} label={key} value={draft[key] ?? ""} onChange={(next) => setValues({ ...draft, [key]: next })} />
            ))}
          </div>
          {problem ? <p className="text-[11.5px] text-down">{problem}</p> : null}
          <HerdTx label="Prepare setAllocations" functionName="setAllocations" args={problem ?? [draft.team, draft.wl, draft.collab, draft.public]} disabled={blocked ?? locked} />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="swap" title="Rollover" />
          <div className="grid grid-cols-3 gap-2">
            <SelectField label="From" value={from} onChange={setFrom} options={HERD_BUCKETS.slice(0, 4).map((bucket, index) => [String(index), bucket])} />
            <SelectField label="To" value={to} onChange={setTo} options={HERD_BUCKETS.map((bucket, index) => [String(index), bucket])} />
            <TextField label="Qty" value={qty} onChange={setQty} />
          </div>
          <p className="text-[11px] text-ink-3">WL ↔ collab before Ended · WL/collab → public or burn from Public · public → team/burn and team → burn once Ended.</p>
          <HerdTx label="Prepare rollover" functionName="rollover" args={/^\d+$/u.test(qty) && Number(qty) > 0 ? [from, to, qty] : "Enter a quantity."} disabled={blocked} confirm={to === "4" ? "BURN" : undefined} />
        </Card>
      </div>
      <Partners overview={overview} blocked={blocked} />
    </Section>
  );
}

function Partners({ overview, blocked }: { readonly overview: HerdOverview | undefined; readonly blocked: string | null }) {
  const admin = useHerdAdmin();
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [cap, setCap] = useState("50");
  const [wallets, setWallets] = useState("");
  const parsed = parseWalletList(wallets);
  const tagProblem = tag ? partnerTagProblem(tag) : "Enter a tag.";
  const save = async () => {
    try {
      await admin.putPartner.mutateAsync({ tag, name: name || tag, cap: Number(cap) || 0, wallets: parsed.wallets });
      toast.success(`Partner ${tag} saved`, { description: `${parsed.wallets.length} wallets · rebuild the collab list` });
      setTag("");
      setName("");
      setWallets("");
    } catch (error) {
      toast.error("Could not save the partner", { description: describeError(error) });
    }
  };
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <CardHead glyph="people" title="Collab partners" right={<Pill tone="mute">{overview?.partners.length ?? 0}</Pill>} />
        {(overview?.partners ?? []).length === 0 ? <p className="text-[12px] text-ink-3">No partners yet. The owner provides the partner list.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(overview?.partners ?? []).map((partner) => (
            <li key={partner.tag} className="bg-paper p-3 px-frame-thin">
              <div className="flex items-center justify-between gap-2">
                <b className="font-display text-[15px] text-ink">{partner.name}</b>
                <Pill tone="mute">{partner.tag}</Pill>
              </div>
              <p className="mt-1 text-[11.5px] text-ink-2">
                {partner.wallets.length} wallets · cap {partner.cap} · <span className="font-mono">{short(partner.tagHex)}</span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <HerdTx label={`Set cap ${partner.cap} on chain`} functionName="setCollabCap" args={[partner.tagHex, String(partner.cap)]} disabled={blocked} variant="ink" />
                <Button variant="ghost" size="sm" onClick={() => void admin.deletePartner.mutateAsync(partner.tag)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3">
        <CardHead glyph="people" title="Add or update a partner" />
        <div className="grid grid-cols-3 gap-2">
          <TextField label="Tag" value={tag} onChange={(next) => setTag(next.toLowerCase())} placeholder="kalos" />
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Cap" value={cap} onChange={setCap} />
        </div>
        <AreaField label="Wallets" value={wallets} onChange={setWallets} placeholder="0x…, one per line or comma separated" hint={`${parsed.wallets.length} valid${parsed.invalid.length ? ` · ${parsed.invalid.length} invalid: ${parsed.invalid.slice(0, 3).join(", ")}` : ""}`} />
        {tag && tagProblem ? <p className="text-[11.5px] text-down">{tagProblem}</p> : null}
        <Button variant="primary" size="sm" disabled={Boolean(tagProblem)} loading={admin.putPartner.isPending} onClick={() => void save()}>
          Save partner
        </Button>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------- merkle + exports */

function Lists({ overview }: { readonly overview: HerdOverview | undefined }) {
  const admin = useHerdAdmin();
  const config = overview?.config;
  const blocked = notDeployed(config);
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (path: string, name: string) => {
    setBusy(name);
    try {
      await downloadExport(path, name);
    } catch (error) {
      toast.error("Export failed", { description: describeError(error) });
    } finally {
      setBusy(null);
    }
  };
  const lists: readonly { readonly list: HerdListId; readonly title: string; readonly what: string }[] = [
    { list: "wl", title: "WL list", what: "approved applications" },
    { list: "collab", title: "Collab list", what: "partner wallets (address, tag)" },
    { list: "snapshot", title: "Mainnet snapshot", what: "testnet WL-approved + collab + testnet minters" },
  ];
  return (
    <Section id="herd-lists" tag="Merkle roots · exports" title="Lists your wallet publishes." lede="Build a list, compare its root with the one on chain, then publish it with setMerkleRoot. Proofs served to minters always match the last build. Testnet WL holders and minters become the mainnet allowlist (snapshot).">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {lists.map(({ list, title, what }) => {
          const build = overview?.builds.find((entry) => entry.list === list);
          const onChain = list === "wl" ? config?.merkleRoots.wl : list === "collab" ? config?.merkleRoots.collab : null;
          const synced = build && onChain ? build.root === onChain : null;
          return (
            <Card key={list} className="flex flex-col gap-3">
              <CardHead glyph="book" title={title} right={synced === true ? <Pill tone="up" dot>on chain</Pill> : synced === false ? <Pill tone="warn" dot>differs</Pill> : <Pill tone="mute">{build ? "built" : "not built"}</Pill>} />
              <p className="text-[12px] text-ink-2">{what}</p>
              <KV
                rows={[
                  ["Leaves", build ? String(build.count) : "—"],
                  ["Root", build ? <span key="r" className="font-mono">{short(build.root)}</span> : "—"],
                  ["On chain", list === "snapshot" ? "mainnet (later)" : onChain ? <span key="c" className="font-mono">{short(onChain)}</span> : "not set"],
                  ["Built", build ? `${build.builtAt.slice(0, 16).replace("T", " ")} · ${short(build.builtBy)}` : "—"],
                ]}
              />
              <Button variant="ink" size="sm" loading={admin.build.isPending && admin.build.variables === list} onClick={() => void admin.build.mutateAsync(list).catch((error: unknown) => toast.error("Build failed", { description: describeError(error) }))}>
                Build {title.toLowerCase()}
              </Button>
              {list !== "snapshot" && build ? <HerdTx label="Prepare setMerkleRoot" functionName="setMerkleRoot" args={[list === "wl" ? "0" : "1", build.root]} disabled={blocked ?? (synced ? "This root is already on chain." : null)} /> : null}
              <div className="mt-auto flex flex-wrap gap-2">
                {list === "snapshot" ? (
                  <>
                    <Button variant="ghost" size="xs" loading={busy === "snap-csv"} onClick={() => void download("/v1/admin/herd/snapshot?format=csv", "herd-snapshot.csv")}>CSV</Button>
                    <Button variant="ghost" size="xs" loading={busy === "snap-json"} onClick={() => void download("/v1/admin/herd/snapshot?format=json", "herd-snapshot.json")}>JSON + root</Button>
                  </>
                ) : build ? (
                  <>
                    <Button variant="ghost" size="xs" onClick={() => void download(`/v1/admin/herd/merkle/${list}/export?format=csv`, `herd-${list}.csv`)}>CSV + proofs</Button>
                    <Button variant="ghost" size="xs" onClick={() => void download(`/v1/admin/herd/merkle/${list}/export?format=json`, `herd-${list}.json`)}>JSON + root</Button>
                  </>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-center text-[11.5px] text-ink-3">Leaves: OpenZeppelin StandardMerkleTree (keccak256(bytes.concat(keccak256(abi.encode(...))))), sorted pairs, as ElyHerd verifies.</p>
    </Section>
  );
}

/* ------------------------------------------------------------- reveal */

function Reveal({ config }: { readonly config: HerdConfigResponse | undefined }) {
  const blocked = notDeployed(config);
  const admin = config?.admin;
  const [provenance, setProvenance] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [base, setBase] = useState("");
  const [contract, setContract] = useState("");
  const frozen = config?.reveal.frozen ? "Metadata is frozen forever." : null;
  const minted = (config?.totalSupply ?? 0) > 0;
  return (
    <Section id="herd-reveal" tag="Metadata · reveal" title="Placeholder, commit, reveal, freeze." lede="The provenance hash (sha256 of the ordered image hashes) is set before the first mint. After the mint, commit to a future block; reveal derives the offset from its hash. Fix metadata any time before you freeze.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="eye" title="State" right={config?.reveal.revealed ? <Pill tone="up">revealed</Pill> : <Pill tone="mute">unrevealed</Pill>} />
          <KV
            rows={[
              ["Provenance", config?.reveal.provenanceHash ? <span key="p" className="font-mono">{short(config.reveal.provenanceHash)}</span> : <span key="p" className="text-warn-ink">not set</span>],
              ["Placeholder", admin?.placeholderURI || "not set"],
              ["Base URI", admin?.baseURI || "not set"],
              ["Contract URI", admin?.contractURI || "not set"],
              ["Commit block", admin?.revealCommitBlock ? String(admin.revealCommitBlock) : "none"],
              ["Offset", admin?.revealOffset ?? "—"],
              ["Frozen", config?.reveal.frozen ? "yes (forever)" : "no"],
            ]}
          />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="docs" title="URIs and provenance" />
          <TextField label="Provenance hash" value={provenance} onChange={setProvenance} placeholder="0x… from the art pipeline" />
          <HerdTx label="Prepare setProvenanceHash" functionName="setProvenanceHash" args={/^0x[0-9a-fA-F]{64}$/u.test(provenance.trim()) ? [provenance.trim()] : "Paste the 32-byte hash."} disabled={blocked ?? (minted ? "Locked: the first mint happened." : null)} variant="ink" />
          <TextField label="Placeholder URI" value={placeholder} onChange={setPlaceholder} placeholder="https://…/v1/herd/tokens/0 or ipfs://…" />
          <HerdTx label="Prepare setPlaceholderURI" functionName="setPlaceholderURI" args={placeholder.trim() ? [placeholder.trim()] : "Enter the URI."} disabled={blocked ?? frozen} variant="ink" />
          <TextField label="Base URI" value={base} onChange={setBase} placeholder="https://…/v1/herd/tokens/" hint="tokenURI = base + id. Fixing it before freeze is fine (EIP-4906 refresh event)." />
          <HerdTx label="Prepare setBaseURI" functionName="setBaseURI" args={base.trim() ? [base.trim()] : "Enter the URI."} disabled={blocked ?? frozen} variant="ink" />
          <TextField label="Contract URI" value={contract} onChange={setContract} placeholder="https://… collection JSON" />
          <HerdTx label="Prepare setContractURI" functionName="setContractURI" args={contract.trim() ? [contract.trim()] : "Enter the URI."} disabled={blocked} variant="ink" />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="star" title="Reveal" />
          <p className="text-[12px] text-ink-2">1. Commit once the mint is ENDED or sold out. 2. Reveal after block commit + {admin?.revealDelayBlocks ?? 32}, within 256 blocks. 3. Check tokens, then freeze.</p>
          <HerdTx label="Prepare commitReveal" functionName="commitReveal" args={[]} disabled={blocked ?? (config?.reveal.revealed ? "Already revealed." : null)} />
          <HerdTx label="Prepare reveal" functionName="reveal" args={[]} disabled={blocked ?? (config?.reveal.revealed ? "Already revealed." : admin?.revealCommitBlock ? null : "Commit first.")} />
          <HerdTx label="Prepare freezeMetadata" functionName="freezeMetadata" args={[]} disabled={blocked ?? (!config?.reveal.revealed ? "Freeze only after the reveal." : frozen)} variant="danger" confirm="FREEZE" />
        </Card>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- operations */

function Operations({ config, owner }: { readonly config: HerdConfigResponse | undefined; readonly owner: string }) {
  const blocked = notDeployed(config);
  const admin = config?.admin;
  const [teamTo, setTeamTo] = useState("");
  const [teamQty, setTeamQty] = useState("10");
  const [withdrawTo, setWithdrawTo] = useState<string | null>(null);
  const [royaltyTo, setRoyaltyTo] = useState("");
  const [royaltyBps, setRoyaltyBps] = useState("500");
  const [newOwner, setNewOwner] = useState("");
  const left = config?.allocations ? config.allocations.team - config.allocations.teamMinted : null;
  const withdrawTarget = withdrawTo ?? admin?.treasury ?? admin?.owner ?? owner;
  return (
    <Section id="herd-ops" tag="Operations" title="Team mint, funds, pause." lede="Proceeds stay in the contract until you withdraw them to the owner or the treasury: no one else can. The pause is the emergency stop for every mint.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="pause" title="Emergency pause" right={config?.paused === null || config?.paused === undefined ? <Pill tone="mute">—</Pill> : config.paused ? <Pill tone="dn" dot>paused</Pill> : <Pill tone="up" dot>minting allowed</Pill>} />
          <p className="text-[12px] text-ink-2">{config?.paused ? "Every mint reverts until you unpause." : "Pausing stops every mint at once. Tokens and funds are untouched."}</p>
          {config?.paused ? <HerdTx label="Prepare unpause" functionName="unpause" args={[]} disabled={blocked} confirm="RESUME" /> : <HerdTx label="Prepare pause" functionName="pause" args={[]} disabled={blocked} variant="danger" confirm="PAUSE" />}
          <HerdTx label={admin?.eoaOnly === false ? "Prepare setEoaOnly(true)" : "Prepare setEoaOnly(false)"} functionName="setEoaOnly" args={[admin?.eoaOnly === false]} disabled={blocked} variant="ink" />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="people" title="Team mint" right={<Pill tone="mute">{left ?? "—"} left</Pill>} />
          <TextField label="To (team wallet)" value={teamTo} onChange={setTeamTo} placeholder="0x…" />
          <TextField label="Quantity" value={teamQty} onChange={setTeamQty} hint="Batches of 50 or fewer." />
          <HerdTx label="Prepare teamMint" functionName="teamMint" args={isAddress(teamTo) && /^\d+$/u.test(teamQty) ? [teamTo.trim(), teamQty] : "Enter the team wallet and a quantity."} disabled={blocked} />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="wallet" title="Withdraw" right={<Pill tone="mute">{admin?.balanceWei ? formatHype(admin.balanceWei) : "—"}</Pill>} />
          <SelectField
            label="To"
            value={withdrawTarget ?? ""}
            onChange={setWithdrawTo}
            options={withdrawOptions(admin?.treasury, admin?.owner)}
          />
          <HerdTx label="Prepare withdraw" functionName="withdraw" args={withdrawTarget && !ZERO.test(withdrawTarget) ? [withdrawTarget] : "No owner or treasury read yet."} disabled={blocked} confirm="WITHDRAW" />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="percent" title="Royalty (ERC-2981)" />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Receiver" value={royaltyTo || admin?.treasury || ""} onChange={setRoyaltyTo} />
            <TextField label="Bps (≤ 1000)" value={royaltyBps} onChange={setRoyaltyBps} />
          </div>
          <HerdTx label="Prepare setRoyalty" functionName="setRoyalty" args={isAddress(royaltyTo || admin?.treasury || "") ? [(royaltyTo || admin?.treasury || "").trim(), royaltyBps] : "Enter the receiver."} disabled={blocked} variant="ink" />
          <p className="text-[11px] text-ink-3">Kalos pays its own creator fee (their admin sets it); this is the on-chain hint other venues read.</p>
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="key" title="Ownership (two-step)" />
          <TextField label="New owner" value={newOwner} onChange={setNewOwner} placeholder="0x… (a multisig is better)" />
          <HerdTx label="Prepare transferOwnership" functionName="transferOwnership" args={isAddress(newOwner) ? [newOwner.trim()] : "Enter the new owner."} disabled={blocked} variant="danger" confirm="TRANSFER" />
          {admin?.pendingOwner ? <HerdTx label="Prepare acceptOwnership (as the pending owner)" functionName="acceptOwnership" args={[]} disabled={blocked} variant="ink" /> : null}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="wallet" title="Treasury" />
          <p className="text-[12px] text-ink-2">On chain: {admin?.treasury ? <span className="font-mono">{short(admin.treasury)}</span> : "—"}. Config: {config?.links.treasury ? <span className="font-mono">{short(config.links.treasury)}</span> : "not configured"}.</p>
          <HerdTx label="Prepare setTreasury(config value)" functionName="setTreasury" args={config?.links.treasury ? [config.links.treasury] : "HERD_TREASURY_ADDRESS is not set."} disabled={blocked ?? (config?.links.treasury && admin?.treasury === config.links.treasury ? "Already the treasury." : null)} variant="ink" />
        </Card>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- WL settings */

function WlSetup({ overview }: { readonly overview: HerdOverview | undefined }) {
  const admin = useHerdAdmin();
  const settings = overview?.settings;
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("custom");
  const [url, setUrl] = useState("");
  const [points, setPoints] = useState("2");
  const [evidence, setEvidence] = useState("text");
  const [verification, setVerification] = useState("manual");
  const add = async () => {
    try {
      await admin.createTask.mutateAsync({ kind: kind as never, label, url: url.trim() || null, points: Number(points) || 0, evidence: evidence as never, verification: verification as never, required: true });
      setLabel("");
      setUrl("");
    } catch (error) {
      toast.error("Could not add the task", { description: describeError(error) });
    }
  };
  return (
    <Section id="herd-wl" tag="WL · settings and tasks" title="The application, your rules." lede="Applicants sign in with their wallet, do the tasks, share their card and submit. Without an X API key, X tasks are links you review by hand: nothing is scraped.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="grid" title="Settings" right={settings?.applicationsOpen ? <Pill tone="up" dot>open</Pill> : <Pill tone="dn" dot>closed</Pill>} />
          <Button variant={settings?.applicationsOpen ? "danger" : "primary"} size="sm" loading={admin.settings.isPending} onClick={() => void admin.settings.mutateAsync({ applicationsOpen: !settings?.applicationsOpen })}>
            {settings?.applicationsOpen ? "Close applications" : "Open applications"}
          </Button>
          <SelectField label="Re-apply after rejection" value={String(settings?.reapplyLimit ?? 1)} onChange={(next) => void admin.settings.mutateAsync({ reapplyLimit: Number(next) })} options={[["0", "not allowed"], ["1", "once"], ["2", "twice"], ["3", "3 times"]]} />
          <SelectField label="Wallet moves per application" value={String(settings?.moveLimit ?? 1)} onChange={(next) => void admin.settings.mutateAsync({ moveLimit: Number(next) })} options={[["0", "none"], ["1", "once"], ["2", "twice"]]} />
          <p className="text-[11px] text-ink-3">{settings?.updatedBy ? `Updated ${settings.updatedAt?.slice(0, 16).replace("T", " ")} by ${short(settings.updatedBy)}` : "Defaults."}</p>
        </Card>
        <Card className="flex flex-col gap-3 md:col-span-2">
          <CardHead glyph="check" title="Tasks" right={<Pill tone="mute">{overview?.tasks.length ?? 0}</Pill>} />
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(overview?.tasks ?? []).map((task) => (
              <li key={task.id} className={cx("flex flex-wrap items-center gap-2 bg-paper p-2.5 px-frame-thin", !task.active && "opacity-60")}>
                <b className="min-w-0 flex-1 text-[13px] text-ink">{task.label}</b>
                <Pill tone="mute">{task.kind}</Pill>
                <Pill tone="mute">{task.points} pts</Pill>
                <Pill tone={task.verification === "manual" ? "mute" : "acc"}>{task.verification}</Pill>
                <span className="w-full text-[11px] text-ink-3">{task.url ?? (task.kind === "follow-x" ? (overview?.config.links.xProfile ?? "link not configured (HERD_X_PROFILE_URL)") : task.kind === "engage-post" ? (overview?.config.links.engagementPosts[0] ?? "link not configured (HERD_ENGAGEMENT_POST_URLS)") : "no link")} · evidence {task.evidence} · {task.required ? "required" : "optional"}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="xs" onClick={() => void admin.updateTask.mutateAsync({ id: task.id, patch: { active: !task.active } })}>
                    {task.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => void admin.updateTask.mutateAsync({ id: task.id, patch: { required: !task.required } })}>
                    {task.required ? "Make optional" : "Make required"}
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => void admin.deleteTask.mutateAsync(task.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <TextField label="New task" value={label} onChange={setLabel} placeholder="Join the Telegram" className="col-span-2 md:col-span-1" />
            <SelectField label="Kind" value={kind} onChange={setKind} options={[["custom", "custom"], ["follow-x", "follow on X"], ["engage-post", "engage a post"], ["share-card", "share the card"]]} />
            <TextField label="Link" value={url} onChange={setUrl} placeholder="https://…" />
            <TextField label="Points" value={points} onChange={setPoints} />
            <SelectField label="Evidence" value={evidence} onChange={setEvidence} options={[["text", "text"], ["tweet-url", "X post link"], ["post-url", "any link"], ["x-handle", "X handle"], ["none", "none"]]} />
            <SelectField label="Verification" value={verification} onChange={setVerification} options={[["manual", "manual"], ["link-check", "link check"], ["x-api", "X API"]]} />
          </div>
          <Button variant="primary" size="sm" disabled={label.trim().length < 2} loading={admin.createTask.isPending} onClick={() => void add()}>
            Add task
          </Button>
        </Card>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- raffle */

function Raffle({ overview }: { readonly overview: HerdOverview | undefined }) {
  const admin = useHerdAdmin();
  const [winners, setWinners] = useState("100");
  const [ahead, setAhead] = useState("3000");
  const run = async (task: () => Promise<unknown>, what: string) => {
    try {
      await task();
    } catch (error) {
      toast.error(what, { description: describeError(error) });
    }
  };
  return (
    <Section id="herd-raffle" tag="Raffle" title="A weighted draw anyone can check." lede="Pending applicants enter with weight 1 + score/25 (max 5×). The entrant list is frozen and hashed at commit; the seed is a future Elysium block hash. Same inputs, same winners.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="star" title="Commit a draw" />
          <TextField label="Winners" value={winners} onChange={setWinners} />
          <TextField label="Blocks ahead" value={ahead} onChange={setAhead} hint="≥ 20. Elysium makes ~8 blocks a second: 3000 ≈ 6 minutes." />
          <p className="text-[11px] text-ink-3">{overview?.counts.pending ?? 0} pending applications; high-flag applicants weigh 0 until you clear their flags.</p>
          <Button variant="primary" size="sm" loading={admin.commitRaffle.isPending} disabled={!(Number(winners) > 0)} onClick={() => void run(() => admin.commitRaffle.mutateAsync({ winners: Number(winners), blocksAhead: Number(ahead) || 3000 }), "Commit failed")}>
            Commit raffle
          </Button>
        </Card>
        <Card className="flex flex-col gap-3 md:col-span-2">
          <CardHead glyph="clock" title="Draws" right={<Pill tone="mute">{overview?.raffles.length ?? 0}</Pill>} />
          {(overview?.raffles ?? []).length === 0 ? <p className="text-[12px] text-ink-3">No draw yet.</p> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(overview?.raffles ?? []).slice(0, 6).map((raffle) => (
              <li key={raffle.id} className="bg-paper p-3 text-[12px] px-frame-thin">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="font-mono text-ink">{raffle.id}</b>
                  <Pill tone={raffle.status === "applied" ? "up" : raffle.status === "drawn" ? "acc" : "mute"}>{raffle.status}</Pill>
                  <span className="text-ink-2">
                    {raffle.winners} of {raffle.entrants} · block {raffle.targetBlock.toLocaleString("en-US")}
                  </span>
                  <span className="flex-1" />
                  {raffle.status === "committed" ? <Button variant="ink" size="xs" loading={admin.drawRaffle.isPending} onClick={() => void run(() => admin.drawRaffle.mutateAsync(raffle.id), "Not yet")}>Draw</Button> : null}
                  {raffle.status === "drawn" ? <Button variant="primary" size="xs" loading={admin.applyRaffle.isPending} onClick={() => void run(() => admin.applyRaffle.mutateAsync(raffle.id), "Apply failed")}>Approve winners</Button> : null}
                </div>
                <div className="mt-1 break-all font-mono text-[10.5px] text-ink-3">
                  entrants {short(raffle.entrantsHash)}
                  {raffle.blockHash ? ` · block hash ${short(raffle.blockHash)} · seed ${short(raffle.seed)}` : ""} · verify at /v1/herd/raffles/{raffle.id}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ dashboard */

function Dashboard() {
  const dashboard = useHerdDashboard(true);
  const data = dashboard.data;
  return (
    <Section id="herd-dashboard" tag="Mint dashboard" title="Every mint, as it lands." lede="From the indexer (Minted, TeamMinted, CollabMinted, Transfer logs). Revenue is the price paid per mint; the contract balance is read live.">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Minted (indexed)" value={data?.minted ?? "—"} note={data?.indexedTo ? `to block ${data.indexedTo.toLocaleString("en-US")}` : "indexer idle"} />
        <Stat label="Revenue" value={data ? formatHype(data.revenueWei) : "—"} note="sum of prices paid" />
        <Stat label="Holders" value={data?.holders ?? "—"} note="distinct owners" />
        <Stat label="In contract" value={data?.contractBalanceWei ? formatHype(data.contractBalanceWei) : "—"} note="withdrawable" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardHead glyph="pulse" title="Recent mints" />
          {data && data.recent.length === 0 ? <p className="text-[12px] text-ink-3">{data.note ?? "No mints yet."}</p> : null}
          <ul className="m-0 flex list-none flex-col p-0">
            {(data?.recent ?? []).slice(0, 10).map((mint) => (
              <li key={mint.tokenId} className="flex items-center gap-3 border-b border-dashed border-rule py-1.5 text-[12px] last:border-b-0">
                <b className="w-16 font-mono text-ink tnum">#{mint.tokenId}</b>
                <span className="font-mono text-ink-2">{short(mint.to)}</span>
                <span className="flex-1" />
                <Pill tone="mute">{mint.bucket ?? mint.phase ?? "—"}</Pill>
                <span className="font-mono text-ink tnum">{formatHype(mint.priceWei)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHead glyph="grid" title="By phase · top holders" />
          <KV rows={Object.entries(data?.byPhase ?? {}).map(([phase, count]) => [phase, String(count)])} />
          <KV rows={(data?.topHolders ?? []).slice(0, 5).map((holder) => [<span key={holder.address} className="font-mono">{short(holder.address)}</span>, String(holder.count)])} />
        </Card>
      </div>
    </Section>
  );
}

function Audit() {
  const audit = useHerdAudit(true);
  return (
    <Section id="herd-audit" tag="Audit log" title="Every admin action, kept." lede="Prepared and sent transactions, decisions, notes, builds, exports, settings, raffles.">
      <Card flat className="max-h-[420px] overflow-y-auto p-0">
        <ul className="m-0 list-none p-0">
          {(audit.data?.audit ?? []).slice(0, 200).map((entry) => (
            <li key={`${entry.at}${entry.action}${entry.detail.slice(0, 20)}`} className="grid grid-cols-1 gap-1 border-b border-dashed border-rule px-4 py-2 text-[12px] md:grid-cols-[150px_150px_minmax(0,1fr)]">
              <span className="font-mono text-ink-3">{entry.at.slice(0, 19).replace("T", " ")}</span>
              <span className="font-tag text-[10.5px] uppercase text-accent">{entry.action}</span>
              <span className="min-w-0 break-words text-ink-2">
                {entry.detail} <span className="text-ink-3">· {short(entry.by)}</span>
              </span>
            </li>
          ))}
        </ul>
        {audit.data && audit.data.audit.length === 0 ? <p className="p-4 text-[12px] text-ink-3">Nothing yet.</p> : null}
      </Card>
    </Section>
  );
}

export function HerdConsole({ owner }: { readonly owner: string }) {
  const overview = useHerdOverview(true);
  const data = overview.data;
  return (
    <div>
      <Overview overview={data} owner={owner} />
      {overview.isError ? <p className="mt-3 text-center text-[12px] text-down">The Herd overview did not load: {describeError(overview.error)}</p> : null}
      <DeployHerd owner={owner} />
      <Phases config={data?.config} />
      <Price config={data?.config} />
      <Supply overview={data} />
      <Lists overview={data} />
      <Reveal config={data?.config} />
      <Operations config={data?.config} owner={owner} />
      <WlSetup overview={data} />
      <HerdQueue overview={data} />
      <Raffle overview={data} />
      <Dashboard />
      <Audit />
    </div>
  );
}
