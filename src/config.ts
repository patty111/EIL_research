import { ethers } from "ethers";
// In a real setup, import specific types from eil-sdk
// import { ChainInfo, PaymasterInfo } from "eil-sdk";

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  contracts: {
    entryPoint: string;
    paymaster: string; // AtomicSwapPaymaster
    accountFactory: string; // E.g., SafeFactory or KernelFactory
  };
}

export const CHAINS: Record<string, ChainConfig> = {
  chainA: {
    chainId: 11155111, // Sepolia (Example)
    name: "Sepolia",
    rpcUrl: process.env.RPC_URL_A || "https://rpc.sepolia.org",
    explorer: "https://sepolia.etherscan.io",
    contracts: {
      entryPoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", // v0.6 EntryPoint
      paymaster: "0xYourDeployedPaymasterAddressOnA",
      accountFactory: "0xYourAccountFactoryOnA",
    },
  },
  chainB: {
    chainId: 80001, // Mumbai (Example)
    name: "Mumbai",
    rpcUrl: process.env.RPC_URL_B || "https://rpc-mumbai.maticvigil.com",
    explorer: "https://mumbai.polygonscan.com",
    contracts: {
      entryPoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      paymaster: "0xYourDeployedPaymasterAddressOnB", // Same bytecode as Chain A
      accountFactory: "0xYourAccountFactoryOnB",
    },
  },
};

// Relayer / XLP Configuration
// For M-of-N, this would be a list of signers or a threshold configuration
export const XLP_CONFIG = {
  signers: [
    process.env.XLP_SIGNER_1_PRIVATE_KEY,
    process.env.XLP_SIGNER_2_PRIVATE_KEY,
    // Add more for M-of-N
  ].filter(Boolean) as string[],
  threshold: 2, // 2-of-N
};
