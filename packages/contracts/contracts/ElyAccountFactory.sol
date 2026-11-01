// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ElyAccount} from "./ElyAccount.sol";

/// @title ElyAccountFactory
/// @author Elyia
/// @notice Deploys ElyAccounts as EIP-1167 clones with CREATE2. The address depends only on
///         (owner, salt), so it can be shown and funded before deployment. Anyone may deploy an
///         account for any owner: the owner is fixed by the salt, so this grants nothing.
/// @dev No admin, no upgrade path. The implementation is created in the constructor and locked.
///      NOT AUDITED.
contract ElyAccountFactory {
    /// @notice The locked ElyAccount implementation all clones delegate to.
    address public immutable implementation;

    event AccountCreated(address indexed account, address indexed owner, bytes32 salt);

    error ZeroAddress();

    constructor() {
        implementation = address(new ElyAccount(address(this)));
    }

    /// @notice Deploy (or return the existing) account of `owner` for `salt`.
    function createAccount(address owner, bytes32 salt) external returns (address account) {
        if (owner == address(0)) revert ZeroAddress();
        bytes32 s = _salt(owner, salt);
        account = Clones.predictDeterministicAddress(implementation, s);
        if (account.code.length != 0) return account;
        Clones.cloneDeterministic(implementation, s);
        ElyAccount(payable(account)).initialize(owner);
        emit AccountCreated(account, owner, salt);
    }

    /// @notice Counterfactual address of the account of `owner` for `salt`.
    function accountAddress(address owner, bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(owner, salt));
    }

    function _salt(address owner, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
