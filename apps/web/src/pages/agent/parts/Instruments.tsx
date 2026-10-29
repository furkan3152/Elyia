import { useState } from "react";

import { routeHref } from "../../../app/routes/routeTable";
import { Link } from "../../../app/routes/Link";
import type { RuleBook } from "@elyia/core/policy";
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

const DAY = 86_400_000;
const LINE_TONE = { up: "text-up", down: "text-down", strong: "font-semibold text-ink" } as const;

/** Card frame shared by the Guide's instruments: caption header, ruled. */
export function InstrumentCard({ title, aside, children, className, tone = "ink" }: { readonly title: React.ReactNode; readonly aside?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string; readonly tone?: "ink" | "summit" }) {
  return (
    <section className={cx("flex min-w-0 flex-col border-2 bg-card shadow-hard", tone === "summit" ? "border-summit" : "border-rule", className)}>
      <header className={cx("flex min-h-[40px] items-center justify-between gap-3 border-b-1.5 px-4 py-2", tone === "summit" ? "border-summit" : "border-rule")}>
        <h2 className={cx("caption truncate", tone === "summit" ? "!text-summit-ink" : "!text-ink")}>{title}</h2>
        {aside ? <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-ink-2">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** The 07:00 bulletin: overnight · on the summit · today. */
export function MorningBulletin({ columns, now, sample, onAsk }: { readonly columns: readonly BulletinColumn[]; readonly now: number; readonly sample: boolean; readonly onAsk: (question: string) => void }) {
  const date = new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  return (
    <InstrumentCard tone="summit" title={`07:00 · Morning bulletin${sample ? " · sample" : ""} · Telegram once linked`} aside={<span className="uppercase tracking-[0.12em] text-summit-ink">{date}</span>}>
      <div className="grid grid-cols-1 divide-y-1.5 divide-summit/40 sm:grid-cols-3 sm:divide-x-1.5 sm:divide-y-0">
        {columns.map((column) => (
          <div key={column.title} className="flex flex-col gap-1.5 px-4 py-3">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.06em] text-ink">{column.title}</h3>
            {column.lines.map((line) => (
              <p key={line.text} className={cx("text-[14px] leading-snug text-ink-2", line.tone ? LINE_TONE[line.tone] : null)}>
                {line.tone === "up" ? "▲ " : line.tone === "down" ? "▼ " : null}
                {line.text}
              </p>
            ))}
            {column.ask ? (
              <button type="button" onClick={() => onAsk(column.ask!.question)} className={cx("mt-auto self-start font-mono text-[12px] text-ink underline decoration-dotted underline-offset-[3px] hover:text-summit-ink", FOCUS_RING)}>
                One tap: {column.ask.label} →
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </InstrumentCard>
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
    <div className="flex flex-col gap-3">
      <GuideLicence
        agent="unissued"
        holder={holder}
        markets={allow && allow.length > 0 ? allow.slice(0, 4) : ["every market"]}
        actions={["order", "cancel", "modify", "TWAP"]}
        limits={limits}
        validFrom={start}
        validUntil={start + days * DAY}
        now={start}
        mode={`Keeper mode · optional · draft`}
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
      <p className="border-l-[3px] border-rule bg-paper-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
        <span className="font-semibold text-ink">Keeper can trade but can never withdraw or move your funds; you can revoke any time.</span> HyperCore itself forbids agent keys from withdrawing or transferring. {keeperOnline ? "" : "The keeper server is coming online; until then the Guide proposes and "}
        <Link to={routeHref("settings")} className={cx("text-ink underline decoration-dotted underline-offset-2", FOCUS_RING)}>
          your browser trading key
        </Link>{" "}
        signs what you approve.
      </p>
    </div>
  );
}

/** Standing orders: rules with an action. They only draft; you sign. */
export function StandingOrders({ rules, statuses, onToggle, onRemove, onAsk }: { readonly rules: readonly AlertRule[]; readonly statuses: ReadonlyMap<string, RuleStatus>; readonly onToggle: (rule: AlertRule) => void; readonly onRemove: (rule: AlertRule) => void; readonly onAsk: (question: string) => void }) {
  return (
    <InstrumentCard title="Standing orders · drafts you sign" aside={<span className="tnum">{rules.filter((rule) => rule.armed).length} armed</span>}>
      {rules.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 py-4">
          <p className="text-[14px] text-ink-2">None yet. Tell the Guide what to watch and what to draft:</p>
          <button type="button" onClick={() => onAsk("when any rope is under 10%, close half")} className={cx("font-mono text-[12px] text-ink underline decoration-dotted underline-offset-[3px]", FOCUS_RING)}>
            “when any rope is under 10%, close half” →
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-rule/15">
          {rules.map((rule) => {
            const status = statuses.get(rule.id);
            return (
              <li key={rule.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
                <p className="min-w-0 font-mono text-[13px] leading-snug text-ink">
                  {rule.action} <span className="text-ink-3">when {ruleCondition(rule)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => onToggle(rule)}
                  aria-pressed={rule.armed}
                  className={cx("flex items-center gap-1.5 border-1.5 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]", rule.armed ? "border-warn text-warn-ink" : "border-rule/40 text-ink-3", FOCUS_RING)}
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
  return <RadioLog entries={radio} title="Guide audit · every move" aside="this device" footer="kept in this browser · the Telegram copy arrives with the bot" maxHeight="260px" />;
}

/** The kill switch: one tap stops every standing order and the key signing anything new. Closing and cancelling still work. */
export function KillSwitch({ on, onPress, onRelease }: { readonly on: boolean; readonly onPress: () => void; readonly onRelease: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (on) {
    return (
      <div role="status" className="flex flex-col gap-2 border-2 border-down bg-down px-4 py-3 text-card shadow-hard">
        <p className="font-sans text-[15px] font-bold uppercase tracking-[0.04em]">Kill switch on · nothing new signs</p>
        <p className="text-[13px] leading-snug text-card/90">Standing orders are paused. Closing positions and cancelling orders still work from the terminal.</p>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setConfirming(false); onRelease(); }} className={cx("border-2 border-card px-2.5 py-1 font-mono text-[12px] font-semibold uppercase tracking-[0.1em]", FOCUS_RING)}>
              Yes, release it
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={cx("px-2 py-1 font-mono text-[12px] underline", FOCUS_RING)}>
              keep it on
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={cx("self-start font-mono text-[12px] underline decoration-dotted underline-offset-[3px]", FOCUS_RING)}>
            Release the kill switch…
          </button>
        )}
      </div>
    );
  }
  return (
    <button type="button" onClick={onPress} className={cx("group flex w-full items-center justify-between gap-3 border-2 border-down bg-card px-4 py-3.5 text-left text-down shadow-hard transition-[background-color,color,transform,box-shadow] duration-fast hover:bg-down hover:text-card active:translate-x-[3px] active:translate-y-[3px] active:shadow-none", FOCUS_RING)}>
      <span className="font-sans text-[15px] font-bold uppercase tracking-[0.04em]">Kill switch · stop every standing order</span>
      <span className="flex shrink-0 items-center gap-1 font-mono text-[11px]">
        <Kbd>⇧</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
