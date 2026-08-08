// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {BetBook} from "../src/BetBook.sol";

/// Deploys BetBook with the deployer's smart-wallet address as first member.
///
/// Usage (from contracts/):
///   export DEPLOYER_KEY=0x...          # throwaway EOA with Base Sepolia faucet ETH
///   export FIRST_MEMBER=0x...          # YOUR PRIVY SMART WALLET address (not the EOA!)
///   export FIRST_MEMBER_NAME=Timothy
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is Script {
    function run() external {
        address firstMember = vm.envAddress("FIRST_MEMBER");
        string memory name = vm.envString("FIRST_MEMBER_NAME");

        address[] memory addrs = new address[](1);
        string[] memory names = new string[](1);
        addrs[0] = firstMember;
        names[0] = name;

        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        new BetBook(addrs, names);
        vm.stopBroadcast();
    }
}
