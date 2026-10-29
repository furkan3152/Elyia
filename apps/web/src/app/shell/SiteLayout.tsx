import React from "react";

import { AuroraBackdrop } from "../../motion/AuroraBackdrop";
import { useRoute } from "../routes/useRoute";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Layout chunk for marketing and public pages (landing, /elysium,
 * /developers). Wallet-free by design: it must never import the wallet stack.
 * The aurora sits behind the header; the landing page gets the full hero sky.
 */
export default function SiteLayout({ children }: { readonly children: React.ReactNode }) {
  const { route } = useRoute();
  return (
    <div className="relative isolate min-h-[100dvh] overflow-x-clip bg-bg-0">
      <AuroraBackdrop variant={route.id === "landing" ? "hero" : "page"} />
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-lg bg-violet-fill px-4 py-2 text-ink-violet focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
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
