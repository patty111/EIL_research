// AdapterWithEILSdk.js
const { ethers } = require("ethers");
// 這裡引入你們 SDK 提供的核心類別 (名稱請對照你們的 SDK 文件)
const { EILClient, MessageBuilder } = require("@eil-protocol/sdk");

class EvmAdapter {
    constructor(config) {
        this.chainId = config.chainId;
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.wallet = new ethers.Wallet(config.privateKey, this.provider);
        this.contractAddress = config.contractAddress;
        
        // 實例化 SDK 的 Client，把 ethers 的 signer 傳進去
        this.eilClient = new EILClient({
            chainId: this.chainId,
            signer: this.wallet,
            targetContract: this.contractAddress
        });
        
        // 保留底層合約實例，用來監聽事件
        this.contract = new ethers.Contract(this.contractAddress, config.abi, this.wallet);
    }

    // 監聽 A 鏈事件 (這部分通常還是用 ethers 來做最直接)
    listen(eventName, callback) {
        console.log(`[Chain ${this.chainId}] 開始監聽事件: ${eventName}`);
        this.contract.on(eventName, callback);
    }

    // 發送交易到 B 鏈 (改用 SDK 接管)
    async relayMessage(msgId, rawPayload) {
        try {
            console.log(`[Chain ${this.chainId}] 準備透過 SDK 封裝並轉發訊息...`);

            // 1. 使用 SDK 的 Builder 將原始 payload 包裝成 EIL 標準格式
            // 這樣目標鏈的 EntryPoint 或 Target 合約才能正確解析 ERC-4337 結構
            const eilMessage = new MessageBuilder()
                .setMessageId(msgId)
                .setPayload(rawPayload)
                .build();

            // 2. 透過 SDK 提交跨鏈訊息
            // SDK 內部會處理 Gas 預估、Nonce 管理，甚至 Relayer 簽名打包
            const txReceipt = await this.eilClient.submitRelay(eilMessage);
            
            console.log(`[Chain ${this.chainId}] 跨鏈交易成功！TxHash: ${txReceipt.hash}`);
            return txReceipt;
        } catch (error) {
            console.error(`[Chain ${this.chainId}] SDK 轉發失敗:`, error);
            throw error;
        }
    }
}

module.exports = EvmAdapter;