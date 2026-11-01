/**
 * The venue catalog (GET /v1/venues): every place the Elyia engine plans,
 * prepares and verifies, with its network, kind and status. Pure helpers
 * plus one react-query hook; when the API is down the pages keep their
 * pinned fallbacks and say so.
 */
import type { VenuesResponse } from "@elyia/core/api/intents";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "./api";

export { swapVenues, venueLayer, type SwapVenueView, type VenueLayer } from "./venueModel";

export function useVenues() {
  return useQuery({
    queryKey: ["venues"],
    queryFn: ({ signal }) => apiGet<VenuesResponse>("/v1/venues", { signal, timeoutMs: 8_000 }),
    staleTime: 5 * 60_000,
    retry: 0,
  });
}
