import React from "react";

import { AuroraBackdrop } from "../../motion/AuroraBackdrop";
import { MobileBar } from "./MobileBar";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";

/**
 * The deck's frame: top bar, left rail (collapsible; a bottom bar on phones),
 * a quiet aurora and the page outlet. Pages render inside `<main>` with
 * `Page` (src/app/shell/Page.tsx) for consistent padding and width.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] bg-bg-0">
      <AuroraBackdrop variant="app" position="fixed" />
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-lg bg-violet-fill px-4 py-2 text-ink-violet focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <TopBar />
      <div className="relative flex">
        <Rail />
        <main id="main-content" tabIndex={-1} className="relative min-w-0 flex-1 pb-24 outline-none md:pb-12">
          {children}
        </main>
      </div>
      <MobileBar />
    </div>
  );
}
