# Running Cross-Chain Transactions


## How It Works
### Ideal EIL Flow Simplified
## Story Background

- Alice wants to move 100 usdc from Op to Arb
- A XLP (Cross Chain Liquidity Provider) holds money on both chains, wants to earn fees
- CrossChainPaymaster (CCPM), a ==Smart Contract== that is deployed on both chains, handling fund locks and voucher redeems
- L1 Stake Manager, a contract on Mainnet, handles disputes

## Story Begins

### Preperation

XLP needs to do this first:
1. goes to Stake Manager → deposits some money (e.g. 5 ETH) and says: “I promise  to be a good guy, if it don’t, slash my deposit.”
2. L1 lets the XLP to register on both Op & Arb, telling the 2 CCPM
3. XLP deposits Liquidity to each chain’s CCPM

→ Op 500 USDC

→ Arb 500 USDC
1. XLP watches Specific Events on both chains (Voucher Request)

### Here Comes the Customer

1. Alice wants to move 100 usdc from Op to Arb
2. Building UserOp on Op (Source Chain)
- Locks 100 usdc in CCPM, gets a voucher for Arb
1. Bulding UserOp on Arb (Dest Chain)
- use voucher to receive 100 usdc and follow my following orders
1. Hashes both UserOps
2. Put both hashes into a Merkle Tree

[Hash OP, Hash Arb]

            ↓

Merkle Root
1. Sign the Merkle Root ONCE
2. Atttach to UserOp

UserOp.signature = {the signature, merkle root, merkle proof}

This all happened in Alice’s Wallet, nothing on chain.

### Alice Submits Op UserOp

Alice → Op Bundler → EntryPoint → Alice’s Smart Account → CCPM
- → Why send to a bundler first then to an EntryPoint? What does these do?

→ A smart account (4337) is a `smart contract` account wallet, since it is a smart contract, you can only interact with it via a contract call. But who calls it?

→ The Bundler is someone who actually uses their computer running a program that watches for UserOps and submits real tx on your behalf

→ If the Bundler can call the Smart Account directly then every wallet would have different rules. Then the Bundler would need to custom code for every different wallet type. An Entrypoint is a Standard for 

B undler < - > Smart Account Call

CCPM Locks 100 usdc from Alice, and emits Voucher Request Event

### XLP Races to Claim

XLP’s are monitoring Op chain for VoucherRequest Events, and bids for the Request
- Note A smart XLP that also runs a **bundler** can bundle Alice's UserOp AND their own claim-voucher transaction into the same block — meaning they earn the fee before any other XLP even sees the event. That's why the most XLPs will run bundlers.

When a XLP decides to claim:

```
XLP → Optimism CCPM: "I claim this request. Here's my signed voucher."

The voucher is a signed message:
"I, XLP, promise to release 100 USDC to Alice on Arbitrum"
Signed by XLP's key.

CCPM on Optimism:
- Verifies XLP is registered and has enough deposited funds on Arbitrum
- Locks Alice's 100 USDC for 1 HOUR (not released to XLP yet)
- Stores: "XLP claimed this, voucher = [signed thing]"
```

The user fund is still locked, only a voucher is issued

### Alice Gets the Voucher and Submits on Arb

Alice's wallet is watching for the `VoucherIssued` event on Optimism:

```
Wallet sees: "XLP issued voucher for my request!"

Wallet does:
  1. Takes the voucher (XLP's signed message)
  2. Appends it to the Arbitrum UserOp signature
     UserOp.sig = { merkle sig, merkle proof, voucher }
  3. Submits to Arbitrum bundler
```

On Arbitrum:

```
Arbitrum Bundler → EntryPoint → Alice's Smart Account → Arbitrum CCPM

Arbitrum CCPM checks:
  1. Is this voucher signed by a registered XLP? ✅
  2. Does that XLP have enough USDC deposited here? ✅
  3. Is the voucher still valid (not expired)? ✅

Then:
  - Pays gas from XLP's Arbitrum deposit (XLP fronts gas too!)
  - Releases 100 USDC to Alice's smart account
  - Alice's calldata executes (transfer, swap, mint NFT, whatever)
```

### XLP Gets Reimbursed (1 Hour Later, Optimistic approach)

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
![alt text](<Merkle Proof Release-2026-04-05-073728.svg>)

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





參考資料: 
1. https://hackmd.io/@1XHOvXHsQ76QF9ptlCibYQ/Bkz_EqKybl
2. https://github.com/eth-infinitism/eil-sdk