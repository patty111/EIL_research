先用 node index.js 啟動 adapter 開始監聽
目前只能開另一個 terminal 手動觸發 op 事件: 
"""bash
cast send 0x525f430483d8e5dbf82C6704410aB8c3e88EF240 "sendMessage(bytes)" 0x1234 --rpc-url $OP_SEPOLIA_RPC_URL --private-key $PRIVATE_KEY
"""