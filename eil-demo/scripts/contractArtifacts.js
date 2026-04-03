/**
 * EIL Contract Artifacts
 *
 * This file imports and re-exports contract artifacts from @eil-protocol/contracts
 * and @account-abstraction/contracts for use in the EIL deployment script.
 */

// ==================== @eil-protocol/contracts ====================

// Core contracts
import CrossChainPaymaster_default from '@eil-protocol/contracts/artifacts/src/CrossChainPaymaster.sol/CrossChainPaymaster.json' with { type: 'json' };
import ICrossChainPaymaster_default from '@eil-protocol/contracts/artifacts/src/ICrossChainPaymaster.sol/ICrossChainPaymaster.json' with { type: 'json' };
import L1AtomicSwapStakeManager_default from '@eil-protocol/contracts/artifacts/src/L1AtomicSwapStakeManager.sol/L1AtomicSwapStakeManager.json' with { type: 'json' };
import SimplePaymaster_default from '@eil-protocol/contracts/artifacts/src/SimplePaymaster.sol/SimplePaymaster.json' with { type: 'json' };

// Utility contracts
import RuntimeVarsHelper_default from '@eil-protocol/contracts/artifacts/src/common/RuntimeVarsHelper.sol/RuntimeVarsHelper.json' with { type: 'json' };
import XlpSelectionHelper_default from '@eil-protocol/contracts/artifacts/src/common/utils/XlpSelectionHelper.sol/XlpSelectionHelper.json' with { type: 'json' };
import AtomicSwapTypes_default from '@eil-protocol/contracts/artifacts/src/common/utils/AtomicSwapTypes.sol/AtomicSwapTypes.json' with { type: 'json' };
import CreateX_default from '@eil-protocol/contracts/artifacts/src/createx/CreateX.sol/CreateX.json' with { type: 'json' };

// Test contracts (for token operations)
import TestERC20_default from '@eil-protocol/contracts/artifacts/src/test/TestERC20.sol/TestERC20.json' with { type: 'json' };

// Bridge connectors - Arbitrum
import L1ArbitrumBridgeConnector_default from '@eil-protocol/contracts/artifacts/src/bridges/arbitrum/L1ArbitrumBridgeConnector.sol/L1ArbitrumBridgeConnector.json' with { type: 'json' };
import L2ArbitrumBridgeConnector_default from '@eil-protocol/contracts/artifacts/src/bridges/arbitrum/L2ArbitrumBridgeConnector.sol/L2ArbitrumBridgeConnector.json' with { type: 'json' };

// Bridge connectors - Optimism
import L1OptimismBridgeConnector_default from '@eil-protocol/contracts/artifacts/src/bridges/optimism/L1OptimismBridgeConnector.sol/L1OptimismBridgeConnector.json' with { type: 'json' };
import L2OptimismBridgeConnector_default from '@eil-protocol/contracts/artifacts/src/bridges/optimism/L2OptimismBridgeConnector.sol/L2OptimismBridgeConnector.json' with { type: 'json' };

// Bridge connectors - Ethereum Local
import L1EthereumLocalBridge_default from '@eil-protocol/contracts/artifacts/src/bridges/ethereum/L1EthereumLocalBridge.sol/L1EthereumLocalBridge.json' with { type: 'json' };

// Mock bridges (for local testing)
import MockL1Bridge_default from '@eil-protocol/contracts/artifacts/src/bridges/mock/MockL1Bridge.sol/MockL1Bridge.json' with { type: 'json' };
import MockL2Bridge_default from '@eil-protocol/contracts/artifacts/src/bridges/mock/MockL2Bridge.sol/MockL2Bridge.json' with { type: 'json' };

// Destination swap modules
import DestinationSwapDisputeManager_default from '@eil-protocol/contracts/artifacts/src/destination/DestinationSwapDisputeManager.sol/DestinationSwapDisputeManager.json' with { type: 'json' };

// Origin swap modules
import OriginationSwapDisputeManager_default from '@eil-protocol/contracts/artifacts/src/origin/OriginationSwapDisputeManager.sol/OriginationSwapDisputeManager.json' with { type: 'json' };
import OriginSwapManager_default from '@eil-protocol/contracts/artifacts/src/origin/OriginSwapManager.sol/OriginSwapManager.json' with { type: 'json' };

// ==================== @account-abstraction/contracts ====================

// EntryPoint and SimpleAccountFactory from ERC-4337 reference implementation
import EntryPoint_default from '@account-abstraction/contracts/artifacts/EntryPoint.json' with { type: 'json' };
import SimpleAccountFactory_default from '@account-abstraction/contracts/artifacts/SimpleAccountFactory.json' with { type: 'json' };

// Use viem's built-in entryPoint08Abi for ABI compatibility
import { entryPoint08Abi } from 'viem/account-abstraction';

// ==================== EXPORTS ====================

export {
  // Core EIL contracts
  CrossChainPaymaster_default,
  ICrossChainPaymaster_default,
  L1AtomicSwapStakeManager_default,
  SimplePaymaster_default,

  // Utility contracts
  RuntimeVarsHelper_default,
  XlpSelectionHelper_default,
  AtomicSwapTypes_default,
  CreateX_default,

  // Test contracts
  TestERC20_default,

  // Bridge connectors - Arbitrum
  L1ArbitrumBridgeConnector_default,
  L2ArbitrumBridgeConnector_default,

  // Bridge connectors - Optimism
  L1OptimismBridgeConnector_default,
  L2OptimismBridgeConnector_default,

  // Bridge connectors - Ethereum Local
  L1EthereumLocalBridge_default,

  // Mock bridges
  MockL1Bridge_default,
  MockL2Bridge_default,

  // Destination swap modules
  DestinationSwapDisputeManager_default,

  // Origin swap modules
  OriginationSwapDisputeManager_default,
  OriginSwapManager_default,

  // Account abstraction contracts
  EntryPoint_default,
  SimpleAccountFactory_default,

  // ABI for EntryPoint (from viem)
  entryPoint08Abi,
};
