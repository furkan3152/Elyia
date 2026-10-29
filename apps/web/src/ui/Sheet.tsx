import { X } from "lucide-react";
import React, { useId } from "react";

import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { ModalLayer } from "./overlay/ModalLayer";

export interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** "right" (default) slides from the side; "bottom" from the bottom edge (phones, quick actions). */
  readonly side?: "right" | "bottom";
  readonly footer?: React.ReactNode;
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly children?: React.ReactNode;
}

/** Side or bottom panel with the same modal mechanics as Dialog (focus trap, Esc, restore focus). */
export function Sheet({ open, onClose, title, description, side = "right", footer, initialFocusRef, className, children }: SheetProps) {
  const id = useId();
  return (
    <ModalLayer
      open={open}
      onClose={onClose}
      labelledBy={`${id}-title`}
      describedBy={description ? `${id}-desc` : undefined}
      initialFocusRef={initialFocusRef}
      placement={side}
      panelClassName={cx(
        "flex flex-col border-line-strong bg-bg-1 shadow-raised",
        side === "right"
          ? "h-full w-full max-w-md animate-sheet-in-right border-l"
          : "max-h-[85dvh] w-full animate-sheet-in-bottom rounded-t-3xl border-t",
        className,
      )}
    >
      {side === "bottom" ? <span aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-text-2/40" /> : null}
      <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-display text-2xl leading-tight text-text-0">
            {title}
          </h2>
          {description ? (
            <p id={`${id}-desc`} className="mt-1 text-sm text-text-1">
              {description}
            </p>
          ) : null}
        </div>
        <IconButton label="Close" icon={<X className="h-4 w-4" aria-hidden="true" />} size="sm" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      {footer ? <div className="safe-bottom flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div> : null}
    </ModalLayer>
  );
}
