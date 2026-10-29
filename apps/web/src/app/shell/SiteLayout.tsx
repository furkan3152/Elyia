import React, { useLayoutEffect } from "react";

import { TopoDefs } from "../../topo/TopoDefs";
import { setThemeSurface } from "../state/documentSync";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Layout chunk for marketing and public pages (landing, /elysium,
 * /developers, /system). Wallet-free by design: it must never import the
 * wallet stack. The site is the DAY sheet unless the visitor chose NIGHT.
 */
export default function SiteLayout({ children }: { readonly children: React.ReactNode }) {
  useLayoutEffect(() => setThemeSurface("site"), []);
  return (
    <div className="relative isolate min-h-[100dvh] overflow-x-clip bg-paper">
      <TopoDefs />
      <a href="#main-content" className="sr-only z-[100] border-2 border-rule bg-signal px-4 py-2 font-bold text-signal-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="relative z-10 outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
