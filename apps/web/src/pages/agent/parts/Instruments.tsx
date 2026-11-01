import type { RuleBook } from "@elyia/core/policy";
import React, { useCallback, useState } from "react";

import { routeHref } from "../../../app/routes/routeTable";
import { Link } from "../../../app/routes/Link";
import { ElyEmpty } from "../../../pixel/ElyEmpty";
import { weatherGlyph, type WeatherGlyph } from "../../../pixel/glyphs";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { PixelGlyph } from "../../../pixel/PixelGlyph";
import { GuideLicence } from "../../../topo/GuideLicence";
import { RadioLog, type RadioEntry } from "../../../topo/RadioLog";
import { Button } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Kbd } from "../../../ui/Kbd";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import type { AlertRule, RuleStatus } from "../../alerts/model/rules";
import { ruleCondition } from "../../alerts/model/rules";
import type { BulletinColumn } from "../guide/facts";
import type { AuditEntry } from "../guide/guideStore";
import { drawKillSwitch, KILL_H, KILL_W } from "../guide/killSwitch";

const DAY = 86_400_000;
const LINE_TONE = { up: "text-up", down: "text-down", strong: "font-semibold text-ink" } as const;

/** A framed card with a Silkscreen head bar: the Guide's instruments share it. */
export function InstrumentCard({ title, aside, children, className, tone = "ink" }: { readonly title: React.ReactNode; readonly aside?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string; readonly tone?: "ink" | "summit" }) {
  return (
    <section className={cx("flex min-w-0 flex-col bg-card px-frame px-drop", className)}>
      <header className={cx("flex min-h-[44px] items-center justify-between gap-3 border-b-2 border-rule px-4 py-2", tone === "summit" ? "bg-accent text-accent-ink" : "bg-paper-2")}>
        <h3 className={cx("truncate font-tag text-[12px] uppercase", tone === "summit" ? "text-accent-ink" : "text-ink")}>{title}</h3>
        {aside ? <div className={cx("flex shrink-0 items-center gap-2 font-tag text-[11px] uppercase", tone === "summit" ? "text-accent-ink" : "text-ink-2")}>{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

const BULLETIN_SKY: readonly WeatherGlyph[] = ["few", "clear", "overcast"];

function skyFor(column: BulletinColumn, index: number): WeatherGlyph {
  if (column.lines.some((line) => line.tone === "down")) return index === 2 ? "storm" : "overcast";
  return BULLETIN_SKY[index] ?? "clear";
}

/** The 07:00 bulletin as three equal weather cards: overnight · on the summit · today. */
export function MorningBulletin({ columns, now, sample, onAsk }: { readonly columns: readonly BulletinColumn[]; readonly now: number; readonly sample: boolean; readonly onAsk: (question: string) => void }) {
  const date = new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  return (
    <ol className="px-cards m-0 list-none p-0" style={{ ["--cards-lg" as string]: 3, ["--cards-md" as string]: 3, ["--cards-sm" as string]: 1, ["--cards-xs" as string]: 1 }} aria-label={`Morning bulletin, ${date}${sample ? ", sample" : ""}`}>
      {columns.map((column, index) => {
        const sky = skyFor(column, index);
        return (
          <li key={column.title} className="flex flex-col bg-card px-frame px-drop">
            <header className="flex flex-col items-center gap-2 border-b-2 border-rule bg-paper-2 px-4 pb-3 pt-4 text-center">
              <PixelGlyph rows={weatherGlyph(sky)} scale={4} label={`${column.title}: ${sky === "storm" ? "storm" : sky === "overcast" ? "overcast" : sky === "few" ? "a few clouds" : "clear"}`} />
              <h3 className="font-display text-[22px] font-bold text-ink">{column.title}</h3>
              <span className="font-tag text-[11px] uppercase text-ink-3">
                {index === 0 ? "last 24 h" : index === 1 ? "Elysium" : date}
                {sample ? " · sample" : ""}
              </span>
            </header>
            <div className="flex flex-1 flex-col gap-2 px-5 py-4">
              {column.lines.map((line) => (
                <p key={line.text} className={cx("text-[14px] leading-snug text-ink-2", line.tone ? LINE_TONE[line.tone] : null)}>
                  {line.tone === "up" ? "▲ " : line.tone === "down" ? "▼ " : null}
                  {line.text}
                </p>
              ))}
              {column.ask ? (
                <button type="button" onClick={() => onAsk(column.ask!.question)} className={cx("px-btn px-btn-thin mt-auto self-center px-btn-signal px-3 py-1.5 font-tag text-[11px] uppercase text-signal-ink", FOCUS_RING)}>
                  Ask Ely: {column.ask.label} ▸
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function usdCap(value: string | undefined): string {
  return value === undefined ? "none" : `$${Number(value).toLocaleString("en-US")}`;
}

/** Keeper mode's permit: a draft until the keeper is online; the scope and limits come from your Rule Book. */
export function LicenceCard({ holder, book, days, onDays, now, sample, keeperOnline }: { readonly holder: string; readonly book: RuleBook; readonly days: 7 | 14 | 30; readonly onDays: (days: 7 | 14 | 30) => void; readonly now: number; readonly sample: boolean; readonly keeperOnline: boolean }) {
  const start = Math.floor(now / DAY) * DAY;
  const allow = book.trading?.markets?.allow;
  const limits: [string, string][] = [
    ["Per order", `≤ ${usdCap(book.trading?.maxNotionalUsd)} · ≤ ${book.trading?.maxLeverage ?? "—"}×${book.trading?.reduceOnly ? " · reduce-only" : ""}`],
    ["Day loss cap", book.trading?.dailyLossUsd ? `${usdCap(book.trading.dailyLossUsd)} → licence suspends itself` : "none set · set one in Settings"],
  ];
  return (
    <div className="flex h-full flex-col gap-7">
      <GuideLicence
        agent="unissued"
        holder={holder}
        markets={allow && allow.length > 0 ? allow.slice(0, 4) : ["every market"]}
        actions={["order", "cancel", "modify", "TWAP"]}
        limits={limits}
        validFrom={start}
        validUntil={start + days * DAY}
        now={start}
        mode="Keeper mode · optional · draft"
        sample={sample}
        footer={
          <>
            <SegmentedControl<"7" | "14" | "30">
              label="Licence length"
              size="sm"
              value={String(days) as "7" | "14" | "30"}
              onChange={(value) => onDays(Number(value) as 7 | 14 | 30)}
              options={[
                { value: "7", label: "7 d" },
                { value: "14", label: "14 d" },
                { value: "30", label: "30 d" },
              ]}
            />
            <Button variant="primary" size="sm" disabled={!keeperOnline} title={keeperOnline ? undefined : "The Elyia keeper is not online yet"}>
              Issue · sign approve-agent
            </Button>
          </>
        }
      />
      <p className="flex-1 bg-paper-2 px-4 py-3 text-[13px] leading-snug text-ink-2 px-frame-thin">
        <span className="font-semibold text-ink">The keeper can trade but can never withdraw or move your funds; you can revoke any time.</span> HyperCore itself forbids agent keys from withdrawing or transferring. {keeperOnline ? "" : "The keeper server is coming online; until then Ely proposes and "}
        <Link to={routeHref("settings")} className={cx("text-ink underline decoration-dotted underline-offset-2", FOCUS_RING)}>
          your browser trading key
        </Link>{" "}
        signs what you approve.
      </p>
    </div>
  );
}

/** Standing orders: rules with an action. They only draft; you sign. */
export function StandingOrders({ rules, statuses, onToggle, onRemove, onAsk, className }: { readonly rules: readonly AlertRule[]; readonly statuses: ReadonlyMap<string, RuleStatus>; readonly onToggle: (rule: AlertRule) => void; readonly onRemove: (rule: AlertRule) => void; readonly onAsk: (question: string) => void; readonly className?: string }) {
  return (
    <InstrumentCard className={className} title="Standing orders · drafts you sign" aside={<span className="tnum">{rules.filter((rule) => rule.armed).length} armed</span>}>
      {rules.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center">
          <ElyEmpty
            compact
            title="No standing orders"
            description="Tell Ely what to watch and what to draft when it happens. It drafts; you sign."
            action={
              <button type="button" onClick={() => onAsk("when any rope is under 10%, close half")} className={cx("px-btn px-btn-thin px-btn-paper px-3 py-1.5 font-mono text-[12px] text-ink", FOCUS_RING)}>
                “when any rope is under 10%, close half” ▸
              </button>
            }
          />
        </div>
      ) : (
        <ul className="flex flex-1 flex-col divide-y-2 divide-dashed divide-rule">
          {rules.map((rule) => {
            const status = statuses.get(rule.id);
            return (
              <li key={rule.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3">
                <p className="min-w-0 font-mono text-[13px] leading-snug text-ink">
                  {rule.action} <span className="text-ink-3">when {ruleCondition(rule)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => onToggle(rule)}
                  aria-pressed={rule.armed}
                  className={cx("px-btn px-btn-thin flex items-center gap-1.5 px-2 py-0.5 font-tag text-[11px] uppercase", rule.armed ? "px-btn-signal text-signal-ink" : "px-btn-paper text-ink-3", FOCUS_RING)}
                >
                  <span aria-hidden="true">{rule.armed ? "●" : "○"}</span>
                  {rule.armed ? "Armed" : "Paused"}
                </button>
                <p className="col-span-2 flex justify-between gap-2 font-mono text-[11px] text-ink-3">
                  <span>{status?.reading ?? "—"}</span>
                  <button type="button" onClick={() => onRemove(rule)} className={cx("hover:text-down", FOCUS_RING)} aria-label={`Delete standing order: ${rule.action}`}>
                    delete ✕
                  </button>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </InstrumentCard>
  );
}

export function AuditLog({ entries }: { readonly entries: readonly AuditEntry[] }) {
  const radio: RadioEntry[] =
    entries.length > 0
      ? entries.slice(0, 30).map((entry) => ({ id: entry.id, at: entry.at, from: entry.from, to: entry.to, message: entry.message, tone: entry.tone }))
      : [{ id: "empty", at: "--:--:--", from: "GUIDE", to: "you", message: "Nothing on the log yet. Every proposal, signature, refusal and kill-switch press lands here." }];
  return <RadioLog className="px-drop" entries={radio} title="Guide audit · every move" aside="this device" footer="kept in this browser · the Telegram copy arrives with the bot" maxHeight="320px" />;
}

function SwitchArt({ on, hover }: { readonly on: boolean; readonly hover: boolean }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawKillSwitch(ctx, { on, hover, seconds: info.seconds, still: info.still }), [on, hover]);
  return <PixelCanvas width={KILL_W} height={KILL_H} scale={5} draw={draw} animate={on} fps={4} redrawKey={`${on}|${hover}`} decorative />;
}

/**
 * The big pixel kill switch: one press stops every standing order and the
 * key signing anything new (Shift+K anywhere on the page). Closing and
 * cancelling still work. Releasing it asks once more.
 */
export function KillSwitch({ on, onPress, onRelease }: { readonly on: boolean; readonly onPress: () => void; readonly onRelease: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [hover, setHover] = useState(false);
  if (on) {
    return (
      <div role="status" className="flex h-full flex-col items-center gap-4 bg-card px-5 pb-6 pt-5 text-center px-frame px-tone-down px-drop">
        <SwitchArt on hover={false} />
        <p className="font-display text-[24px] font-bold leading-tight text-down">Kill switch on</p>
        <p className="max-w-[30ch] text-[14px] leading-snug text-ink-2">Nothing new signs. Standing orders are paused. Closing and cancelling still work from the terminal.</p>
        {confirming ? (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <Button variant="danger" size="sm" onClick={() => { setConfirming(false); onRelease(); }}>
              Yes, release it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep it on
            </Button>
          </div>
        ) : (
          <Button variant="ink" size="sm" onClick={() => setConfirming(true)}>
            Release the kill switch…
          </Button>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPress}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-label="Kill switch: stop every standing order and every new signature. Shift+K."
      className={cx("group flex h-full w-full flex-col items-center gap-4 bg-card px-5 pb-6 pt-5 text-center px-frame px-tone-down px-drop px-press", FOCUS_RING)}
    >
      <SwitchArt on={false} hover={hover} />
      <span className="font-display text-[24px] font-bold leading-tight text-down">Kill switch</span>
      <span className="max-w-[30ch] text-[14px] leading-snug text-ink-2">One press stops every standing order and every new signature.</span>
      <span className="mt-auto flex items-center gap-2 font-tag text-[11px] uppercase text-ink-3">
        or press <Kbd>⇧</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

/** What the kill switch stops and what keeps working: the two mirrored cards beside it. */
export function KillNote({ side, on }: { readonly side: "stops" | "works"; readonly on: boolean }) {
  const stops = side === "stops";
  const lines = stops
    ? ["Every standing order pauses", "The trading key signs nothing new", "Ely keeps reading, drafts nothing", "Stays on until you release it"]
    : ["Closing positions (reduce-only)", "Cancelling open orders", "Reading the range and the radio", "Your wallet, which never signed here"];
  return (
    <section className="flex h-full flex-col bg-card px-frame px-drop" aria-labelledby={`kill-${side}`}>
      <header className={cx("flex items-center justify-center gap-2 border-b-2 border-rule px-4 py-3", stops ? "bg-down text-card" : "bg-up text-card")}>
        <h3 id={`kill-${side}`} className="font-tag text-[12px] uppercase">
          {stops ? "✕ What it stops" : "✓ What still works"}
        </h3>
      </header>
      <ul className="flex flex-1 flex-col justify-center gap-3 px-5 py-5">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-3 text-[14px] leading-snug text-ink-2">
            <span aria-hidden="true" className={cx("mt-1 inline-block h-2 w-2 shrink-0", stops ? "bg-down" : "bg-up")} />
            {line}
          </li>
        ))}
      </ul>
      <p className="border-t-2 border-dashed border-rule px-4 py-2 text-center font-tag text-[11px] uppercase text-ink-3">{stops ? (on ? "now: stopped" : "now: running") : "always"}</p>
    </section>
  );
}
