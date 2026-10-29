import { useState } from "react";

import { openOracle } from "../../oracle/oracleStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Popover } from "../../ui/Popover";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/useToast";
import { KitSection } from "./KitSection";

/** Dialog, Sheet, Popover, toasts and the Oracle. */
export function OverlaysSection() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const toast = useToast();
  return (
    <KitSection
      id="overlays"
      title="Dialog · Sheet · Popover · Toast · Oracle"
      description="Dialog and Sheet share one accessible modal layer: portal, focus moved in and trapped, Esc and backdrop close, scroll lock, focus back to the opener. Dialog becomes a bottom sheet on phones. Toasts never carry the only copy of an action."
      code={'<Dialog open={open} onClose={close} title="Flatten all?" footer={<Button variant="danger">Flatten 4 positions</Button>}>…</Dialog>\nconst toast = useToast(); toast.success("Address copied");\nopenOracle("long ETH 5x");'}
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialog(true)}>
          Open dialog
        </Button>
        <Button variant="outline" onClick={() => setSheet(true)}>
          Open sheet
        </Button>
        <Popover label="Example popover" align="start" trigger={(props) => <Button variant="outline" {...props}>Popover</Button>}>
          {(close) => (
            <div className="flex w-56 flex-col gap-2">
              <p className="text-sm text-text-1">A small non-modal panel.</p>
              <Button size="sm" variant="soft" onClick={close}>
                Close
              </Button>
            </div>
          )}
        </Popover>
        <Button variant="ghost" onClick={() => toast.success("Plan ready", { description: "2 steps · 1 signature" })}>
          Success toast
        </Button>
        <Button variant="ghost" onClick={() => toast.error("Could not reach the Elyia API", { description: "Check your connection and retry.", action: { label: "Retry", onClick: () => undefined } })}>
          Error toast
        </Button>
        <Button variant="gold" onClick={() => openOracle("bridge 20 HYPE to Elysium and swap half to USDC")}>
          Open the Oracle
        </Button>
      </div>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Flatten all positions?"
        description="Four HyperCore positions close at market."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Keep them
            </Button>
            <Button variant="danger" onClick={() => setDialog(false)}>
              Flatten 4 positions
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-1">Kit example: nothing is sent. In the terminal this asks before closing every position with a reduce-only market order.</p>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Order details" description="Kit example sheet.">
        <p className="text-sm text-text-1">Sheets slide from the side on desktop or the bottom on phones (side=&quot;bottom&quot;).</p>
      </Sheet>
    </KitSection>
  );
}
