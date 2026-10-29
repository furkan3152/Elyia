import React, { useLayoutEffect } from "react";

import { TopoDefs } from "../../topo/TopoDefs";
import { setThemeSurface } from "../state/documentSync";
import { AppFooter } from "./SiteFooter";
import { MobileBar } from "./MobileBar";
import { TopBar } from "./TopBar";

/**
 * The deck's frame: the map-sheet header (nav, Where to?, switches, wallet,
 * margin strip with the layer altimeter), the page outlet, a title-block
 * footer, and signpost tabs on phones. Pages render inside `<main>` with
 * `Page` (src/app/shell/Page.tsx).
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  useLayoutEffect(() => setThemeSurface("app"), []);
  return (
    <div className="relative min-h-[100dvh] bg-paper">
      <TopoDefs />
      <a href="#main-content" className="sr-only z-[100] border-2 border-rule bg-signal px-4 py-2 font-bold text-signal-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <TopBar />
      <main id="main-content" tabIndex={-1} className="relative min-w-0 pb-24 outline-none md:pb-6">
        {children}
      </main>
      <AppFooter />
      <MobileBar />
    </div>
  );
}
