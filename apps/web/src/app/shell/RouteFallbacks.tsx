import { RotateCcw } from "lucide-react";

import { Button } from "../../ui/Button";
import { ElyiaMark } from "./ElyiaMark";

/** Shown while a layout or page chunk loads for the first time: the mark, breathing. No spinner. */
export function BootFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status">
      <span className="sr-only">Loading Elyia</span>
      <span aria-hidden="true" className="el-loop animate-breathe">
        <ElyiaMark size={44} />
      </span>
    </div>
  );
}

/** A chunk failed to download (offline, or a new release replaced the files). */
export function RouteLoadFailed({ reload }: { readonly reload: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" role="alert">
      <div className="flex max-w-md flex-col items-start gap-4 rounded-3xl border border-line-strong bg-bg-1 p-7 shadow-raised">
        <ElyiaMark size={36} />
        <p className="font-display text-3xl text-text-0">This page could not load</p>
        <p className="text-sm text-text-1">Part of Elyia failed to download, usually because the connection dropped or a new version was released. Reload to try again.</p>
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
    <main id="main-content" className="flex min-h-[100dvh] items-center justify-center bg-bg-0 p-4">
      <div className="flex max-w-md flex-col items-start gap-3 rounded-3xl border border-line-strong bg-bg-1 p-6">
        <ElyiaMark size={32} />
        <h1 className="font-display text-2xl text-text-0">Elyia opens in its own tab</h1>
        <p className="text-sm text-text-1">For your safety this page cannot run inside another website. Open it directly to continue.</p>
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg bg-violet-fill px-4 text-sm font-semibold text-ink-violet">
          Open Elyia
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </main>
  );
}
