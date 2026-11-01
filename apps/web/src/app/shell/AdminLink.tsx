import { ShieldCheck } from "lucide-react";

import { useSessionRole } from "../../features/session/sessionStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Link } from "../routes/Link";
import { ADMIN_ITEM } from "./navItems";

/**
 * A small way into the owner console, drawn only for an admin session (the
 * server re-checks the role on every admin request; this only decides what
 * to draw). Never part of the public nav.
 */
export function AdminLink({ className }: { readonly className?: string }) {
  const admin = useSessionRole("admin");
  if (!admin) return null;
  return (
    <Link
      to={ADMIN_ITEM.href}
      aria-label={`${ADMIN_ITEM.label} (admin)`}
      title={ADMIN_ITEM.hint}
      className={cx("inline-flex h-9 w-9 shrink-0 items-center justify-center font-tag text-[10px] uppercase text-ink-2 px-btn px-btn-paper hover:text-ink aria-[current=page]:text-accent", FOCUS_RING, className)}
    >
      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}
