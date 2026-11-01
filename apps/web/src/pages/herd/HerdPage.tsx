import { useMemo } from "react";
import { useAccount } from "wagmi";

import { useHerdConfig } from "../../features/herd/herdApi";
import { short } from "../../features/herd/herdModel";
import { SessionBridge } from "../../features/session/SessionBridge";
import { HerdPortrait } from "../../pixel/Herd";
import { herdMember } from "../../pixel/herd";
import { Page, Section } from "../../pixel/layout";
import { ButtonLink } from "../../ui/Button";
import { Gallery } from "./parts/Gallery";
import { MintCard } from "./parts/MintCard";
import { Supply } from "./parts/Supply";
import { Traits } from "./parts/Traits";
import { Chip, Fact, TestnetBadge } from "./parts/ui";
import { Utilities } from "./parts/Utilities";
import { YourGoat } from "./parts/YourGoat";

/**
 * /herd: The Herd, the Ely NFT collection. Live supply and phase from the
 * recorded ElyHerd (or "not deployed"), the mint card with every case, the
 * gallery and traits drawn in the browser, your goat, utilities and facts.
 */
export default function HerdPage() {
  const config = useHerdConfig();
  const data = config.data;
  const { address } = useAccount();
  const hero = useMemo(() => herdMember(1), []);
  const testnet = data?.testnet ?? true;
  return (
    <Page>
      <SessionBridge />
      <Section
        level={1}
        seam={false}
        tag={`The Herd · Elysium${testnet ? " testnet" : ""} · ERC-721`}
        title="Ely, as 3,333 goats."
        lede="Every goat is drawn in code from the Ely sprite engine, on the map of the layer it lives on. Hold one and it becomes your Ely across Elyia."
        actions={
          <>
            <TestnetBadge testnet={testnet} />
            <ButtonLink to="/herd/wl" variant="signpost">
              Apply for the WL
            </ButtonLink>
          </>
        }
      >
        <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2">
          <figure className="m-0 flex flex-col bg-card px-frame px-drop-lg">
            <div className="flex flex-1 items-center" style={{ background: hero.backdrop }}>
              <HerdPortrait member={hero} fluid className="w-full" />
            </div>
            <figcaption className="flex items-center justify-between gap-3 px-4 py-3 font-tag text-[12px] uppercase text-ink">
              <span>{hero.name}</span>
              <span className="text-ink-3">preview art</span>
            </figcaption>
          </figure>
          <MintCard config={data} />
        </div>
        {config.isError ? <p className="mt-4 text-center text-[12.5px] text-down">The Elyia API did not answer, so live supply is unknown. The gallery below still works.</p> : null}
      </Section>
      <Section id="supply" tag="Live supply · phases" title="Where the mint stands." lede={data?.source === "chain" ? "Read from the contract every few seconds." : "Nothing is on chain yet: these are the planned numbers."}>
        <Supply config={data} />
      </Section>
      {address ? (
        <Section id="your-goat" tag="Your goat" title="Your Ely.">
          <YourGoat address={address.toLowerCase()} config={data} />
        </Section>
      ) : null}
      <Section id="gallery" tag="Gallery" title="Meet the herd." lede="Browse all 3,333 by number. The art is final; which token shows which goat is fixed at the reveal by a provenance hash and a future block.">
        <Gallery />
      </Section>
      <Section id="traits" tag="Traits · rarity" title="What makes a goat rare." lede="Nine traits, each option with its count across the herd. Fifteen hand-made 1/1 legendaries carry only their own trait.">
        <Traits />
      </Section>
      <Section id="utilities" tag="Utilities" title="What holding one does." lede="Perks on the Elyia platform, checked on chain.">
        <Utilities />
      </Section>
      <Section id="facts" tag="Contract" title="The facts.">
        <div className="mx-auto grid max-w-[860px] grid-cols-1 gap-x-8 bg-card p-5 px-frame md:grid-cols-2">
          <div>
            <Fact label="Network">{data ? `${data.testnet ? "Elysium testnet" : "Elysium"} · ${data.chainId}` : "—"}</Fact>
            <Fact label="Contract">{data?.address ? short(data.address) : "not deployed yet"}</Fact>
            <Fact label="Standard">ERC-721 · ERC-2981 · EIP-4906</Fact>
            <Fact label="Supply">3,333 · 1 per wallet</Fact>
          </div>
          <div>
            <Fact label="Royalty">{data?.royalty.bps !== null && data?.royalty.bps !== undefined ? `${(data.royalty.bps / 100).toFixed(1)}%` : "5% planned"}</Fact>
            <Fact label="Provenance">{data?.reveal.provenanceHash ? short(data.reveal.provenanceHash) : "set before the mint"}</Fact>
            <Fact label="Marketplace">{data?.links.marketplace ? <a className="text-accent underline" href={data.links.marketplace} target="_blank" rel="noreferrer noopener">Kalos ↗</a> : "Kalos · not listed yet"}</Fact>
            <Fact label="Mainnet">{data?.links.mainnetLaunch ? `planned ${data.links.mainnetLaunch.slice(0, 10)}` : "date not announced"}</Fact>
          </div>
        </div>
        <p className="mt-4 text-center">
          <Chip tone="mute">Not audited · your wallet signs every mint</Chip>
        </p>
      </Section>
    </Page>
  );
}
