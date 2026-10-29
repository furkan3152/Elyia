import { RotateCcw } from "lucide-react";

import { Button } from "../../ui/Button";
import { ContourLoader } from "../../ui/ContourLoader";
import { ElyiaMark } from "./ElyiaMark";

/** Shown while a layout or page chunk loads for the first time: contours drawing on. No spinner. */
export function BootFallback() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-ink" role="status">
      <span className="sr-only">Loading Elyia</span>
      <ContourLoader size={40} className="el-loop text-contour" />
      <span aria-hidden="true" className="caption">
        Surveying the sheet
      </span>
    </div>
  );
}

/** A chunk failed to download (offline, or a new release replaced the files). */
export function RouteLoadFailed({ reload }: { readonly reload: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" role="alert">
      <div className="flex max-w-md flex-col items-start gap-4 border-2 border-rule bg-card p-7 shadow-hard-lg">
        <ElyiaMark size={36} className="text-ink" />
        <p className="text-3xl font-bold tracking-[-0.02em] text-ink">This sheet could not load</p>
        <p className="text-[15px] text-ink-2">Part of Elyia failed to download, usually because the connection dropped or a new version was released. Reload to try again.</p>
        <Button variant="primary" onClick={reload} leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}>
          Reload
        </Button>
      </div>
    </div>
  );
}

/** Elyia refuses to run inside another site's frame (clickjacking guard); /tg is the exception. */
export function FramedRouteNotice({ href }: { readonly href: string }) {
  return (
    <main id="main-content" className="flex min-h-[100dvh] items-center justify-center bg-paper p-4">
      <div className="flex max-w-md flex-col items-start gap-3 border-2 border-rule bg-card p-6 shadow-hard-lg">
        <ElyiaMark size={32} className="text-ink" />
        <h1 className="text-2xl font-bold text-ink">Elyia opens in its own tab</h1>
        <p className="text-[15px] text-ink-2">For your safety this page cannot run inside another website. Open it directly to continue.</p>
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center border-2 border-rule bg-accent px-4 text-sm font-bold uppercase tracking-[0.06em] text-accent-ink shadow-hard">
          Open Elyia
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </main>
  );
}
