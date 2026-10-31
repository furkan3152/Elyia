import React from "react";

import { Panel } from "../../ui/Panel";
import { cx } from "../../ui/cx";

/** A specimen card on the key: a Silkscreen caption on the axis, then the specimen, centred. */
export function Specimen({ label, note, children, className, align = "center" }: { readonly label: React.ReactNode; readonly note?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string; readonly align?: "center" | "stretch" }) {
  return (
    <Panel padding="lg" className={cx("flex h-full flex-col gap-5", className)}>
      <div className="text-center">
        <p className="caption !text-ink">{label}</p>
        {note ? <p className="mx-auto mt-2 max-w-[460px] text-[13px] leading-relaxed text-ink-2">{note}</p> : null}
      </div>
      <div className={cx("flex min-w-0 flex-1 flex-col justify-center", align === "center" ? "items-center text-center" : "items-stretch")}>{children}</div>
    </Panel>
  );
}

/** The import line page engineers copy, centred. */
export function ImportLine({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="mx-auto -mt-4 mb-10 w-fit max-w-full truncate bg-card px-3 py-1 font-mono text-xs text-ink-2 px-frame-thin">
      <code>{children}</code>
    </p>
  );
}
