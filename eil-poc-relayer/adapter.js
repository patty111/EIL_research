const { ethers } = require("ethers");

class EvmAdapter {
    constructor(rpcUrl, privateKey, contractAddress, abi) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.contract = new ethers.Contract(contractAddress, abi, this.wallet);
    }

    listen(eventName, callback) {
        console.log(`[Adapter] 開始監聽事件: ${eventName} at ${this.contract.target}`);
        this.contract.on(eventName, callback);
    }

    async sendTransaction(methodName, args) {
        try {
            console.log(`[Adapter] 準備發送交易: ${methodName} 參數:`, args);
            const tx = await this.contract[methodName](...args);
            console.log(`[Adapter] 交易已提交，等待上鏈... TxHash: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`[Adapter] 交易成功！區塊高度: ${receipt.blockNumber}`);
            return receipt;
        } catch (error) {
            console.error(`[Adapter] 交易失敗:`, error);
            throw error;
        }
    }
}

module.exports = EvmAdapter;