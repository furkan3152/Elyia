/**
 * Intents: the language reader (sentence to goals and questions) and the engine (plan, prepare, submit, verify, journey).
 */
import type { ApiModule } from "../../http/router.js";

export const intentsModule: ApiModule = {
  name: "intents",
  register() {
    // No routes yet.
  },
};
