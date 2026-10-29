import { ArrowLeft, Sparkles } from "lucide-react";

import { routeHref } from "../../app/routes/routeTable";
import { useRoute } from "../../app/routes/useRoute";
import { openOracle } from "../../oracle/oracleStore";
import { Button, ButtonLink } from "../../ui/Button";

/** 404 for both the site and the deck (the router picks the layout). */
export default function NotFoundPage() {
  const { route } = useRoute();
  const inDeck = route.kind === "app";
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <p className="eyebrow">404 · off the map</p>
      <h1 className="font-display text-display-md text-text-0">
        No star <span className="display-italic">at this address.</span>
      </h1>
      <p className="text-text-1">The page you asked for does not exist. Say what you wanted instead, or head back.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink to={inDeck ? routeHref("deck") : "/"} variant="outline" leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
          {inDeck ? "Back to the deck" : "Back home"}
        </ButtonLink>
        <Button variant="gold" onClick={() => openOracle()} leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
          Speak your intent
        </Button>
      </div>
    </div>
  );
}
