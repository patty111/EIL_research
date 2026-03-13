// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {SourceContract} from "../src/SourceContract.sol";
import {TargetContract} from "../src/TargetContract.sol";

contract DeploySource is Script {
    function run() external {
        // 從 .env 讀取私鑰
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        
        // 單純部署合約
        SourceContract source = new SourceContract();
        
        vm.stopBroadcast();

        // 在終端機印出合約地址
        console.log("SourceContract deployed at:", address(source));
    }
}

contract DeployTarget is Script {
    function run() external {
        // 從 .env 讀取私鑰
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        
        // 單純部署合約
        TargetContract target = new TargetContract();
        
        vm.stopBroadcast();

        // 在終端機印出合約地址
        console.log("TargetContract deployed at:", address(target));
    }
}