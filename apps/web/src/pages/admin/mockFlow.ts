/**
 * QA only (dev server, `?mockDeploy=<phase>`): a deploy state built without a
 * wallet so the five camps can be screenshotted in every phase. The panel
 * says "QA preview · mocked wallet · nothing is broadcast". Never in a build:
 * AdminPage calls it behind import.meta.env.DEV.
 */
import { CAMPS, deployReducer, predictAddress, type AdminNetwork, type Deployable, type DeployEvent, type DeployPreview, type DeployState } from "./deployModel";
import { ARTIFACTS } from "./useDeploy";

const ORDER = ["previewing", "ready", "signing", "pending", "verifying", "recording", "done"] as const;

export function mockDeployState(search: string, owner: string, contract: Deployable, network: AdminNetwork): DeployState | null {
  const phase = new URLSearchParams(search).get("mockDeploy");
  if (!phase) return null;
  const nonce = 41;
  const predicted = predictAddress(owner, nonce);
  const preview: DeployPreview = {
    contract,
    network,
    chainId: network === "hyperevm-testnet" ? 998 : 99801,
    from: owner,
    nonce,
    predicted,
    data: ARTIFACTS[contract].bytecode as `0x${string}`,
    gas: 1_284_220n,
    gasPriceWei: 2_400_000_000n,
    args: [],
    simulatedSize: (ARTIFACTS[contract].deployedBytecode.length - 2) / 2,
    simulationError: null,
    matchesServerPlan: true,
  };
  const hash = `0x${"0".repeat(60)}0a11`;
  const events: DeployEvent[] = [
    { type: "preview" },
    { type: "previewed", preview },
    { type: "sign" },
    { type: "sent", hash },
    { type: "mined", receipt: { hash, blockNumber: "0", address: predicted, gasUsed: "1191874" } },
    { type: "checked", code: { verdict: "immutables", differing: 20 } },
    { type: "recorded", at: new Date().toISOString() },
  ];
  const failed = phase === "failed";
  const stop = failed ? ORDER.indexOf("signing") : ORDER.indexOf(phase as (typeof ORDER)[number]);
  if (stop < 0) return null;
  let state: DeployState = { phase: "idle" };
  for (const event of events.slice(0, stop + 1)) state = deployReducer(state, event);
  if (failed) state = deployReducer(state, { type: "fail", error: `QA mock: rejected in the wallet at ${CAMPS[1].title}.` });
  return state;
}
