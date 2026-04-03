# Running Cross-Chain Transactions


## How It Works

### Current Status

✅ **Working:**
- Anvil chains running on localhost:8501 (Arbitrum), localhost:8503 (Optimism)
- All contracts deployed with deterministic addresses
- Master account funded on each chain
- Test USDC tokens deployed on both chains

### Prerequisites
> Using Foundry Anvil for local chains. Ensure you have it installed and running.

### How to Test
```bash
git clone https://github.com/patty111/EIL_research
cd eil-demo

yarn chains:start
yarn contracts:deploy
yarn services:start

npx tsx cross-chain.ts

# run yarn system:stop to close everything
```

#### Example Output
* Batch 0: Action on Source Chain (Arbitrum):
* Batch 1: Action on Destination Chain (Optimism):
```bash
Starting cross-chain USDC transfer...
Setting up the EIL SDK...
   Smart wallet address: 0xfDC7DcA57960FDa77ED2d1ed6017FBDFDDd32631
Funding wallet with gas (ETH) and USDC...
   Balance on Arbitrum: 20000 USDC
   Balance on Optimism: 0 USDC
Building the cross-chain sequence...
Signing the transactions...
Executing cross-chain batches...
watching VoucherIssued for 0xfDC7DcA57960FDa77ED2d1ed6017FBDFDDd32631/0 on chain 42161    --> Before doing anything, Alice sets up a listener for the VoucherIssued event on the destination chain, so she can react immediately when the XLP provider issues the voucher
   Batch 0: executing    --> Alice sends her UserOp to the Arb Bundler
   Batch 1: voucherIssued    --> Mock XLP provider sees VoucherIssued, signs voucher, and emits VoucherSigned
   Batch 0: done (tx: 0x41190e7f985f7923...)   --> Arb is mined and confirmed Alice's UserOp
   Batch 1: waitingForVouchers    --> Alice Gets the Voucher and sends it to Dest Chain
   Batch 1: executing    --> Op CCPM receives the voucher, verifies it, and executes the UserOp on Optimism
   Batch 1: done (tx: 0xa8fc959fd822b00b...)
Operation completed! Checking final balances...
   Final Balance on Arbitrum: 19999.7 USDC
   Final Balance on Optimism: 0.3 USDC
```

### Main Contracts Deployment Overview
| Contract | Purpose | Deployed On |
|----------|---------|-------------|
| `EntryPoint` | ERC-4337 execution | All Chains |
| `AccountFactory` | Spawn testing user smart wallet | All Chains |
| `Paymaster` | Handle cross-chain voucher logic | Uniquely on each chain |
| `xlpSelectionHelper` | XLP discovery and selection | All Chains |
| `stakeManager` | Manage XLP stakes and rewards | L1 Only |

### Explanation
1. Currently the XLP listens to a "VoucherRequestCreated" on source chain, then emits a "VoucherIssued" on destination chain. The bundler on destination chain listens to "VoucherIssued" and executes the UserOp when it sees the event.

2. For simplicity, the example did not impl the reclaiming logic of the XLP (XLP取回提供的流動性與獎勵) nor the dispute mechanism

## TODO
1. 目前是 2 chains & single XLP provider setup，後續可以增加更多 chains & providers
2. 目前是用 DummyAccount instead of SimpleAccount
-> EIL SDK 會在使用者 sign 完 UserOperation 後修改到 paymasterData 的格式
以標準來說 (如 SimpleAccount)，UserOp Hash 會被拿去跟完整的包涵 paymasterData 的 UserOp hash 做對比，但因上面提到的改動，導致驗證會失敗
3. 根據參考資料理想且正確的實作方法是 1 個 signature 達成 multichain op, 目前方便起見是分每個鏈都簽一次, 未來要改成 merkle root 實作 1 sig for all





參考資料: https://hackmd.io/@1XHOvXHsQ76QF9ptlCibYQ/Bkz_EqKybl