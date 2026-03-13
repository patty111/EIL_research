// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

contract TargetContract {
    event MessageReceived(bytes32 indexed msgId, bytes payload);

    // 紀錄已經處理過的訊息
    mapping(bytes32 => bool) public processedMessages;
    
    // 儲存最新收到的訊息內容，方便 POC 驗證狀態有被改變
    string public lastMessagePayload;

    // Relayer 呼叫入口
    function receiveMessage(bytes32 msgId, bytes calldata payload) external {
        // 確保同一條訊息不會被執行兩次
        require(!processedMessages[msgId], "Message already processed");

        // 更新狀態
        processedMessages[msgId] = true;
        lastMessagePayload = string(payload); // 視覺化，假設 payload 是字串

        emit MessageReceived(msgId, payload);
    }
}