// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

contract SourceContract {
    event MessageSent(bytes32 indexed msgId, bytes payload);
    
    uint256 public messageNonce;

    function sendMessage(bytes calldata payload) external {
        bytes32 msgId = keccak256(abi.encodePacked(msg.sender, messageNonce, block.timestamp));
        messageNonce++;
        
        emit MessageSent(msgId, payload);
    }
}