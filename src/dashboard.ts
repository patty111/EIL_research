import { ethers } from "ethers";
import { CHAINS } from "./config";

// Interface for dashboard metrics
interface DashboardMetrics {
  pendingVouchers: number;
  successVouchers: number;
  failedVouchers: number;
  avgLatencyMs: number;
  totalGasUsed: bigint;
}

const metrics: DashboardMetrics = {
  pendingVouchers: 0,
  successVouchers: 0,
  failedVouchers: 0,
  avgLatencyMs: 0,
  totalGasUsed: 0n,
};

// Store start times to calculate latency
const voucherStartTimes: Map<string, number> = new Map();

async function startDashboard() {
  console.log("Starting Cross-Chain Dashboard (EIL Observer)...");

  // connect to providers
  const providerA = new ethers.JsonRpcProvider(CHAINS.chainA.rpcUrl);
  const providerB = new ethers.JsonRpcProvider(CHAINS.chainB.rpcUrl);

  const paymasterA = new ethers.Contract(CHAINS.chainA.contracts.paymaster, [
    "event VoucherRequestCreated(bytes32 indexed voucherId, address indexed sender, uint256 value)"
  ], providerA);

  const paymasterB = new ethers.Contract(CHAINS.chainB.contracts.paymaster, [
    "event VoucherRedeemed(bytes32 indexed voucherId, address indexed recipient, uint256 amount)", // Or Issued
    "event VoucherFailed(bytes32 indexed voucherId, string reason)"
  ], providerB);

  // Listener on Chain A (Source)
  paymasterA.on("VoucherRequestCreated", (voucherId, sender, value, event) => {
    console.log(`[A] Voucher Requested: ${voucherId} | Block: ${event.log.blockNumber}`);
    metrics.pendingVouchers++;
    voucherStartTimes.set(voucherId, Date.now());
    updateDisplay();
  });

  // Listener on Chain B (Destination)
  paymasterB.on("VoucherRedeemed", (voucherId, recipient, amount, event) => {
    const endTime = Date.now();
    const startTime = voucherStartTimes.get(voucherId);
    
    if (startTime) {
      const latency = endTime - startTime;
      console.log(`[B] Voucher Success: ${voucherId} | Latency: ${latency}ms`);
      
      // Update Average Latency
      const totalTime = (metrics.avgLatencyMs * metrics.successVouchers) + latency;
      metrics.successVouchers++;
      metrics.pendingVouchers--;
      metrics.avgLatencyMs = totalTime / metrics.successVouchers;
      
      voucherStartTimes.delete(voucherId); // Clean up
    } else {
      console.log(`[B] Voucher Success (Unknown Start): ${voucherId}`);
      metrics.successVouchers++;
    }
    updateDisplay();
  });

  paymasterB.on("VoucherFailed", (voucherId, reason, event) => {
    console.log(`[B] Voucher Failed: ${voucherId} | Reason: ${reason}`);
    metrics.failedVouchers++;
    metrics.pendingVouchers--; // Optionally decrease pending if it's considered resolved
    updateDisplay();
  });

  console.log("Listening for events...");
}

function updateDisplay() {
  console.clear();
  console.log("=== EIL Cross-Chain Dashboard ===");
  console.log(`Pending: \t${metrics.pendingVouchers}`);
  console.log(`Success: \t${metrics.successVouchers}`);
  console.log(`Failed:  \t${metrics.failedVouchers}`);
  console.log(`Avg Latency: \t${metrics.avgLatencyMs.toFixed(2)} ms`);
  console.log("=================================");
}

startDashboard().catch(console.error);
