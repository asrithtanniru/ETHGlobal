// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {GharPayout} from "../src/GharPayout.sol";

contract Deploy is Script {
    // Whitechain Sepolia test USDT (6 decimals, permit + EIP-3009)
    address constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;

    function run() external {
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", operator);
        vm.startBroadcast();
        GharPayout g = new GharPayout(USDT, operator, treasury);
        vm.stopBroadcast();
        console.log("GharPayout deployed at", address(g));
    }
}
