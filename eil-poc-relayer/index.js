require("dotenv").config();
const EvmAdapter = require("./adapter");

// 保持簡單，直接用 Human-Readable ABI不管 json
const SOURCE_ABI = ["event MessageSent(bytes32 indexed msgId, bytes payload)"];
const TARGET_ABI = ["function receiveMessage(bytes32 msgId, bytes calldata payload)"];

async function main() {
    // 1. 初始化 OP 鏈 (source) 的 Adapter
    const sourceAdapter = new EvmAdapter(
        process.env.OP_RPC_URL,
        process.env.PRIVATE_KEY,
        process.env.SOURCE_CONTRACT_ADDRESS,
        SOURCE_ABI
    );

    // 2. 初始化 ARB 鏈 (target) 的 Adapter
    const targetAdapter = new EvmAdapter(
        process.env.ARB_RPC_URL,
        process.env.PRIVATE_KEY,
        process.env.TARGET_CONTRACT_ADDRESS,
        TARGET_ABI
    );

    console.log("Relayer 啟動，等待跨鏈訊息...");

    // 3. 綁定監聽與發送邏輯
    sourceAdapter.listen("MessageSent", async (msgId, payload, event) => {
        console.log("\n========================================");
        console.log(`🎯 偵測到跨鏈訊息!`);
        console.log(`MsgId: ${msgId}`);
        console.log(`Payload: ${payload}`);
        console.log("========================================\n");

        // 收到 OP 的訊息後，立刻用 targetAdapter 送到 ARB
        try {
            await targetAdapter.sendTransaction("receiveMessage", [msgId, payload]);
            console.log("✅ 跨鏈轉發完成");
        } catch (err) {
            console.error("❌ 跨鏈轉發失敗");
        }
    });
}

main().catch(console.error);