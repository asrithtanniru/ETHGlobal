// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GharVault} from "../src/GharVault.sol";

/// @notice Deploys GharVault against the USDT and payout provider addresses in the environment.
contract Deploy is Script {
    function run() external returns (GharVault vault) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdt = vm.envAddress("USDT_ADDRESS");
        address provider = vm.envAddress("PROVIDER_ADDRESS");

        vm.startBroadcast(deployerKey);
        vault = new GharVault(IERC20(usdt), provider);
        vm.stopBroadcast();

        console.log("GharVault", address(vault));
    }
}
