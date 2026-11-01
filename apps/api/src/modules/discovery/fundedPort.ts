/**
 * The engine's EVM port for Shield's dry-run plans: the real chain, except
 * that one dummy account (SHIELD_ACCOUNT, no key exists for it) reads as
 * holding plenty of native HYPE and of every ERC-20, and its eth_calls carry
 * a native balance override. Planning then quotes and prepares as for a
 * funded wallet; the simulation itself runs on real state (the buy really
 * delivers the tokens the sell spends).
 */
import type { NetworkKey } from "@elyia/core";
import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, DecodeFunctionResultReturnType, Hex } from "viem";
import type { CallRequest, EvmPort, LogFilter, SimulationRequest, TxObservation } from "../../engine/ports/evm.js";

export const FUNDED_TOKEN_BALANCE = 10n ** 30n;

export class FundedAccountPort implements EvmPort {
  private readonly account: string;

  constructor(
    private readonly base: EvmPort,
    account: Address,
    private readonly nativeBalance: bigint,
  ) {
    this.account = account.toLowerCase();
  }

  observeTransaction(network: NetworkKey, hash: Hex): Promise<TxObservation> {
    return this.base.observeTransaction(network, hash);
  }
  call(network: NetworkKey, request: CallRequest) {
    return this.base.call(network, request.from?.toLowerCase() === this.account ? { ...request, balances: { ...(request.balances ?? {}), [this.account]: this.nativeBalance } } : request);
  }
  read<const abi extends Abi, name extends ContractFunctionName<abi, "pure" | "view">>(
    network: NetworkKey,
    request: { readonly address: Address; readonly abi: abi; readonly functionName: name; readonly args?: ContractFunctionArgs<abi, "pure" | "view", name> },
  ): Promise<DecodeFunctionResultReturnType<abi, name>> {
    const args = (request.args ?? []) as readonly unknown[];
    if (request.functionName === "balanceOf" && String(args[0]).toLowerCase() === this.account) return Promise.resolve(FUNDED_TOKEN_BALANCE as DecodeFunctionResultReturnType<abi, name>);
    return this.base.read(network, request);
  }
  estimateGas(network: NetworkKey, request: CallRequest & { readonly from: Address }) {
    return this.base.estimateGas(network, request.from.toLowerCase() === this.account ? { ...request, balances: { ...(request.balances ?? {}), [this.account]: this.nativeBalance } } : request);
  }
  simulate(network: NetworkKey, request: SimulationRequest) {
    return this.base.simulate(network, request);
  }
  getBalance(network: NetworkKey, address: Address, block?: bigint) {
    return address.toLowerCase() === this.account ? Promise.resolve(this.nativeBalance) : this.base.getBalance(network, address, block);
  }
  getBlock(network: NetworkKey, block: bigint | "latest" | Hex) {
    return this.base.getBlock(network, block);
  }
  getLogs(network: NetworkKey, filter: LogFilter) {
    return this.base.getLogs(network, filter);
  }
  gasPrice(network: NetworkKey) {
    return this.base.gasPrice(network);
  }
  getStorageAt(network: NetworkKey, address: Address, slot: Hex) {
    return this.base.getStorageAt(network, address, slot);
  }
  getCode(network: NetworkKey, address: Address) {
    return this.base.getCode(network, address);
  }
}
