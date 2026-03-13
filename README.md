# EIL SDK Research & Implementation Plan

## 1. Core Concept Shift: Intents vs. Messages
*   *Paradigm*: "Send bytes from Chain A to Chain B".
*   *Security*: Relayer + Oracle / Light Client.

**EIL (Ethereum Interop Layer)** is different. It uses **Account Abstraction (ERC-4337)**:
*   *Paradigm*: "I seek to execute UserOperations on Chain B, based on proof of payment/action on Chain A".
*   *Mechanism*: **Vouchers**. You lock funds/emit event on Chain A -> XLP (Liquidity Provider/Notary) signs a Voucher -> You use that Voucher to pay for gas/execution on Chain B.
*   *Security*: The **XLP** is the trusted party (can be federated). The **Smart Account** (Safe, Kernel) provides the M-of-N user security.

## 2. Architecture

### Requirement A: Message Cross-chain (Event A -> Call B)
*   **Solution**: Use `CrossChainExecutor` (EIL SDK).
*   **Flow**:
    1.  **Source (Chain A)**: Submit a `UserOp` that emits a specific event or locks tokens (e.g., `VoucherRequest`).
    2.  **Bridging**: An off-chain **XLP** detects this and signs a `Voucher`.
    3.  **Destination (Chain B)**: Submit a `UserOp` that uses the `Voucher` to pay the Paymaster, and executes your target contract call (`calldata` to update governance).

### Requirement B: Support 2 EVM Chains (Reuse Adapter)
*   **Solution**: EIL treats all EVM chains identically via `ChainInfo` configuration.
*   **Adapter**: In EIL, the "Adapter" is the **AtomicSwapPaymaster**. You deploy this *once* (same bytecode) on all supported chains. It handles the verification of XLP signatures.

### Requirement C: Relayer M-of-N
*   **Interpretation**: Entity moving the message to be secure/distributed.
*   **EIL Mapping**: 
    1.  **The User (Source of Truth)**: Use a **Gnosis Safe** (M-of-N) as your Smart Account identity on both chains. EIL supports `Ambire` and `Kernel`, and can support `Safe` via adapters.
    2.  **The Intermediary (XLP)**: Typically a high-availability bot. To make this M-of-N:
        *   *Option A (Easier)*: Run the XLP as a standard server but limit its maximum value per voucher.
        *   *Option B (Advanced)*: Customize the Paymaster to require signatures from *M* out of *N* known XLPs before accepting a voucher.

### Requirement D: Orchestrator State Machine + Event Sourcing
*   **Solution**: The EIL `CrossChainExecutor` *is* a state machine.
*   **States**: `Idle` -> `CheckPending` -> `WaitingForVoucher` -> `ReadyToSign` -> `Submitted`.
*   **Event Sourcing**: The SDK has an `EventsPoller` that reconstructs state from `VoucherRequestCreated` (Chain A) and `VoucherIssued` (Chain B) events. This allows full replayability and auditing.

### Requirement E: Dashboard
*   **Solution**: Since the SDK emits structured events and logs, we can build a simple Node.js dashboard that indexes:
    *   `VoucherRequest` (Pending)
    *   `VoucherIssued` (Success/Bridged)
    *   `Latency` (Time between Request block and Issued block)
*   

### How to Run the Current Thing
1. Start the relayer:

```shell
$ cd eil-poc-relayer
$ node index.js
```
2. Trigger the cross-chain action:

```shell
$ cd eil-poc-contracts
$ source .env
$ cast send 0x525f430483d8e5dbf82C6704410aB8c3e88EF240 "sendMessage(bytes)" 0x1234 --rpc-url $OP_SEPOLIA_RPC_URL --private-key $PRIVATE_KEY
```