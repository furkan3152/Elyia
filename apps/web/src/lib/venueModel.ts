/** The venue catalog (GET /v1/venues), pure: which live venues swap on each layer. */
import type { VenueProbe, VenueView } from "@elyia/core/api/intents";
import { layersFor, NETWORKS, type NetworkEnvironment } from "@elyia/core/networks";

export type VenueLayer = "floor" | "ridge" | "summit";

export interface SwapVenueView {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  /** The engine only routes here when the request names it (venue-specific tokens). */
  readonly explicitOnly: boolean;
  readonly network: string;
  /** A pair the venue holds liquidity for (GET /v1/venues `probe`): what the swap page quotes it with. */
  readonly probe?: VenueProbe;
}

const LAYER_OF_FAMILY: Readonly<Record<string, VenueLayer>> = { hypercore: "floor", hyperevm: "ridge", elysium: "summit" };

export function venueLayer(venue: Pick<VenueView, "network">): VenueLayer {
  return LAYER_OF_FAMILY[NETWORKS[venue.network]?.family ?? "hypercore"] ?? "floor";
}

/** First note that says something about the venue itself (not the generic testnet-price line). */
function noteOf(venue: VenueView): string {
  const note = venue.notes.find((item) => !/testnet pool prices are fake/iu.test(item)) ?? venue.notes[0] ?? "";
  const first = note.split(/(?<=\.)\s/u)[0] ?? note;
  return first.length > 90 ? `${first.slice(0, 88)}…` : first;
}

/** Live swap venues of the mode, per layer: AMMs on the Summit and the Ridge, the spot book on the Floor. */
export function swapVenues(venues: readonly VenueView[], mode: NetworkEnvironment): Record<VenueLayer, SwapVenueView[]> {
  const layers = layersFor(mode);
  const keys = new Set<string>([layers.elysium.key, layers.hyperevm.key, layers.hypercore.key]);
  const out: Record<VenueLayer, SwapVenueView[]> = { summit: [], ridge: [], floor: [] };
  for (const venue of venues) {
    if (venue.status !== "live" || !keys.has(venue.network)) continue;
    const dex = venue.kind === "dex" && venue.actions.includes("swap");
    const book = venue.id === "hypercore-spot";
    if (!dex && !book) continue;
    out[venueLayer(venue)].push({ id: venue.id, label: venue.label, note: noteOf(venue), explicitOnly: venue.explicitOnly, network: venue.network, ...(venue.probe ? { probe: venue.probe } : {}) });
  }
  return out;
}

