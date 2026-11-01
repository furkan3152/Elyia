/** Contract config helpers for the owner console (recorded addresses, explorer links, manifest dependencies). */
import type { ContractsConfigResponse, DeploymentRecord } from "@elyia/core/api/admin";
import { useMemo } from "react";

import { evmNetwork } from "../../app/wallet/chains";
import type { AdminNetwork, Deployable } from "./deployModel";
import { MANIFEST } from "./useDeploy";

export function explorerAddress(network: AdminNetwork, address: string): string | null {
  const explorer = evmNetwork(network).explorer;
  return explorer ? `${explorer.url}${explorer.addressPath}${address}` : null;
}

export function recordedOn(config: ContractsConfigResponse | undefined, network: AdminNetwork): Partial<Record<string, string>> {
  const entry = config?.networks.find((item) => item.network === network);
  return Object.fromEntries(Object.entries(entry?.contracts ?? {}).map(([name, value]) => [name, value?.address ?? ""]).filter(([, value]) => value));
}

/** Dependencies per the manifest: a contract whose args name `$X` waits for X. */
export function dependsOn(contract: Deployable): Deployable[] {
  const step = MANIFEST.order.find((entry) => entry.contract === contract);
  return (step?.constructor ?? []).flatMap((arg) => (typeof arg.value === "string" && arg.value.startsWith("$") && arg.value !== "$OWNER" ? [arg.value.slice(1) as Deployable] : []));
}

export function useRecordsByContract(records: readonly DeploymentRecord[] | undefined, network: AdminNetwork) {
  return useMemo(() => {
    const map = new Map<string, DeploymentRecord>();
    for (const record of records ?? []) if (record.network === network) map.set(record.contract, record);
    return map;
  }, [records, network]);
}
