import { Sparkles } from "lucide-react";
import { useAccount } from "wagmi";

import { WalletButton } from "../../app/shell/WalletButton";
import { openOracle } from "../../oracle/oracleStore";
import { AddressPill } from "../../ui/AddressPill";
import { Chip } from "../../ui/Badge";
import { Panel, PanelHeader } from "../../ui/Panel";
import { REALMS } from "../../ui/networkMeta";
import { NetworkGlyph } from "../../ui/NetworkGlyph";

const LAYERS = [REALMS.hypercore, REALMS.hyperevm, REALMS.elysium] as const;
const BAR: Readonly<Record<string, string>> = { hypercore: "bg-violet-glow/35", hyperevm: "bg-sky/35", elysium: "bg-gold/35" };
const TEXT: Readonly<Record<string, string>> = { hypercore: "text-violet-glow", hyperevm: "text-sky", elysium: "text-gold" };

const QUICK = [
  { label: "Bridge to Elysium", sentence: "bridge 20 HYPE to Elysium" },
  { label: "Stake HYPE → kHYPE", sentence: "stake 10 HYPE to kHYPE" },
  { label: "Move USDC to perps", sentence: "move all my HyperEVM USDC to perps" },
] as const;

/**
 * Net worth across the three layers. The valuation itself arrives with the
 * portfolio build (GET /v1/portfolio/:address); until then the card shows the
 * structure and the connected account, never an invented number.
 */
export function NetWorthCard() {
  const { address, isConnected } = useAccount();
  return (
    <Panel variant="glow" padding="lg" className="flex h-full flex-col rounded-3xl">
      <PanelHeader title="Net worth · 3 layers" aside={isConnected && address ? <AddressPill address={address} network="elysium-testnet" /> : <span>not connected</span>} />
      <div className="flex flex-1 flex-col gap-5">
        <div>
          <p className="font-display text-[clamp(2.6rem,5vw,3.6rem)] leading-none text-text-2" aria-label="Net worth unknown">
            $—<span className="text-[0.55em]">.——</span>
          </p>
          <p className="mt-3 max-w-md text-sm text-text-1">
            {isConnected
              ? "Your HyperCore, HyperEVM and Elysium holdings will add up here, valued in USD, with today's move and funding. The valuation arrives with the portfolio build."
              : "Connect a wallet to see HyperCore, HyperEVM and Elysium as one number. Elyia never holds your keys."}
          </p>
        </div>
        <div>
          <div className="flex h-2 gap-1 overflow-hidden rounded-full" aria-hidden="true">
            {LAYERS.map((layer) => (
              <span key={layer.family} className={`h-full flex-1 rounded-full ${BAR[layer.family]}`} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-text-1">
            {LAYERS.map((layer) => (
              <li key={layer.family} className="flex items-center gap-1.5">
                <span className={TEXT[layer.family]}>
                  <NetworkGlyph family={layer.family} size={12} />
                </span>
                {layer.label} <span className="tnum font-mono text-text-2">—</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {isConnected ? null : <WalletButton />}
          {QUICK.map((action) => (
            <Chip key={action.label} onClick={() => openOracle(action.sentence)} aria-label={`${action.label}: ${action.sentence}`}>
              <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
              {action.label}
            </Chip>
          ))}
        </div>
      </div>
    </Panel>
  );
}
