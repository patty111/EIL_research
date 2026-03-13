https://github.com/eth-infinitism/eil-contracts

atomic swap - 

> [!NOTE] Core Roles and paths
> User - Smart Account
> XLP - Cross chain liquidity provider
> Voucher (憑證) - XLP 簽發的鏈下憑證，代表對源鏈資金的索取權。
> CCP - cross chain paymaster
> 
> ##### Happy Path of Cross Chain Transfer
> ![[Pasted image 20260111141840.png]]
> 
> ##### EIL Flow Deep Dive
> ![[Pasted image 20260111144631.png]]  
> 
> >2.1 和 3.1 只會發生其中一個:
2.1 是交易在 mempool 時 XLP 就進行競標，如果在 mempool 中已有 XLP 願意吃單，RPC 後續會將 user’s commit + XLP’s claim 一起打包上鏈
3.1 是交易在 mempool 時沒有 XLP 願意吃單，user’s commit 會先行上鏈，後續 XLP 會直接在鏈上進行競標

->  how to 鏈上競標? 畢竟不透過第三方
#### On Chain Dispute Mechanism


#### Multichain Account 如何簽一次名再多鏈執行
只需簽一個 merkle root, 透過 merkle proof 進行使用者授權

**反向荷蘭式拍賣 (Fee Discovery)**



## Data Structures

> [!note] **AtomicSwapVoucherRequest**
> >origin chain request


> [!NOTE] **AtomicSwapVoucher**
> >XLP Voucher

## General Flow
### Step 1: Origin Chain - Commit & Request
1. User starts a 交易請求 from the origin chain A (==合約入口: **`OriginSwapManager.sol`**==), checks chainId, Paymaster address matches and checks `senderNonce` to prevent replay attack
2. Locks assets according to `maxFeePercentNumerator` (荷蘭式拍賣最高費率) into *`CrossChainPaymaster Contract`*
3. Set the request status to *AtomicSwapStatus.NEW*
4. Broadcast a *VoucherRequestCreated* Event, let off-chain XLP monitors it and bids.
### Step 2: Origin Chain - XLP Claim & Voucher Issue 
1. When XLP sees the request, they 競爭提交 Voucher (==合約入口: OriginSwapManager.sol==)
2. The contract verifies VoucherSignature (xlpSignature) to see whether it was signed by XLP itself and the content matches the request.
3. Checks permission, verify the XLP is in user designated `allowedXlps` whitelist
> how did the xlp get into the whitelist?
4. 反向荷蘭式拍賣，根據 the time gap between `createdAt` and `issueVouchers` to calculate the realtime `process_fee = startFee + elapsed * feeIncreasePerSecond`
5. Refund the extra fee `maxFee (locked by the user beforehand) - realtime_process_fee`
6. set the request status to *VOUCHER_ISSUED* and record the `voucherIssuerL2XlpAddress`
7. Note the XLP did not get the user asset yet, the asset is still locked inside the Paymaster Contract
### Step3: Destination Chain - Execution
1. The user gets the XLP-signed voucher, constructs a UserOp on the dest chain (==合約入口: CrossChainPaymaster.sol==)
2. **`_validatePaymasterUserOp`** is triggered. It decodes `PaymasterData` from `userOp.paymasterAndData` to get the **AtomicSwapVoucher** and **SessionData**.
    
3. **Gas Pre-charge (_preChargeXlpGas):** The contract deducts `maxUserOpCost` (ETH) directly from the **XLP's balance** in the destination Paymaster.
    
    > _Note: This ensures the Bundler/Miner gets paid even if the swap logic fails._
    
4. **Voucher Verification:**
    
    - Verifies the signature matches the XLP.
        
    - Checks `_verifyVoucherNotExpired` to ensure the voucher is still valid.
        
5. **Asset Transfer (_withdrawFromVoucher):** The contract transfers the agreed assets (ERC-20/ETH) from the **XLP's vault** to `userOp.sender` (the User) immediately.
    
6. **Execute UserOp:** The EntryPoint executes the user's actual business logic (e.g., Uniswap Swap, NFT Mint).
    
    > _Tech Detail: Users can use **SessionData** & **EphemeralKey** to sign dynamic data (like exact swap amounts) without exposing their main private key._
    
7. **Gas Refund (_postOp):** After execution, calculate the _actual_ gas used. Refund the `pre-charged amount - actual cost` back to the XLP's balance.
    

### Step 4: Origin Chain - Settlement & Unlock (Happy Path)

1. **Wait Period:** Wait for the `TIME_TO_DISPUTE` window (usually 1 hour) to pass.
    
2. XLP triggers the settlement (==合約入口: **`OriginSwapManager.sol`**==) via `withdrawFromUserDeposit`.
    
3. **Time Lock Check (_requireVoucherIssuedOrStaleDisputed):**
    
    - If called _within_ the dispute window -> **Revert**.
        
    - If called _after_ the window -> Proceed.
        
4. **Funds Transfer:** The contract moves the User's locked deposit + Fee (`amountsAfterFee`) into the XLP's internal balance (`_tokenIncrementDeposit`).
    
5. **State Finalization:** Update the request state to _AtomicSwapStatus.SUCCESSFUL_.
    

### Step 5: The Unhappy Path - Dispute Mechanism

1. **Trigger Condition:** If XLP defaults on the destination chain (e.g., insufficient balance causes UserOp failure).
    
2. **Prove Insolvency:** Anyone (User/Watchdog) calls `proveXlpInsolvent` on the **Destination Chain**. (==合約入口: **`DestinationSwapDisputeManager`**==)
    
3. **Verification:** Contract checks if `balances[token][xlp] < Voucher amount`.
    
4. **Cross-Chain Slash:**
    
    - If true, generate an _InsolvencyProof_.
        
    - Send message via `BridgeMessengerLib` to the **L1 StakeManager**.