/**
 * Deployment script for EIL Demo - 2 Chain Version (Arbitrum + Optimism)
 * 
 * configured for 2 chains only 
* - Removed Ethereum (L1) deployment logic
 * - Reduced to Arbitrum (42161) + Optimism (10)
 * - Uses only mock bridges for simplicity
 * - Simplified URL configuration (ARB_RPC, OP_RPC)
 */

// ==================== IMPORTS ====================
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

// Resolve script directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from ENV_FILE or default to .env in project root
const envFile = process.env.ENV_FILE || resolve(__dirname, '..', '.env');
dotenvConfig({ path: envFile });
console.log(`📁 Loaded environment from: ${envFile}`);

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  getContract,
  getCreate2Address,
  encodeDeployData,
  keccak256,
  padHex,
  isAddress,
  checksumAddress,
  zeroAddress,
  publicActions,
} from 'viem';
import { privateKeyToAccount, toAccount } from 'viem/accounts';

// Import EIL contract artifacts
import {
  CrossChainPaymaster_default,
  L1AtomicSwapStakeManager_default,
  SimplePaymaster_default,
  RuntimeVarsHelper_default,
  XlpSelectionHelper_default,
  CreateX_default,
  MockL1Bridge_default,
  MockL2Bridge_default,
  DestinationSwapDisputeManager_default,
  OriginSwapManager_default,
  OriginationSwapDisputeManager_default,
  EntryPoint_default,
  SimpleAccountFactory_default,
  TestERC20_default,
  entryPoint08Abi,
} from './contractArtifacts.js';

// ==================== CONSTANTS ====================
const entryPoint09Address = '0x433709009B8330FDa32311DF1C2AFA402eD8D009';
const createXaddress = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
const saltForBytecodeOnly = padHex('0x1', { size: 32 });
const sourcePaymasterOwner = '0x'.padEnd(42, 'face');

const LOCAL_CHAIN_IDS = new Set([
  1337n, // common dev chain id
  31337n, // hardhat
  31338n,
  31339n,
]);

// ==================== UTILITY FUNCTIONS ====================

function writeDeploymentFile(fileName, deployments) {
  const dir = fileName.substring(0, fileName.lastIndexOf('/'));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(fileName, JSON.stringify(deployments, null, 2));
  console.log(`📄 Deployment file written: ${fileName}`);
}

function getEnv(name, defaultVal) {
  if (process.env[name] == null) {
    if (defaultVal != null) {
      return defaultVal;
    }
    throw new Error(`Environment ${name} not found`);
  }
  return process.env[name];
}

function normalizeAddress(value, label) {
  if (value == null) {
    throw new Error(`${label} must be provided`);
  }
  if (!isAddress(value)) {
    throw new Error(`${label} is not a valid address: ${value}`);
  }
  return value;
}

// ==================== CLIENT CREATION ====================

async function createChain(transport) {
  const client = createPublicClient({ transport });
  const chainId = await client.getChainId();
  return {
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Native', symbol: 'nat', decimals: 18 },
    rpcUrls: { default: { http: [client.transport.url] } },
  };
}

async function createWalletClientFromUrl(rpcUrl, account) {
  const transport = http(rpcUrl);
  return createWalletClient({
    account,
    chain: await createChain(transport),
    transport,
  });
}

async function createPublicClientFromUrl(rpcUrl, pollingInterval) {
  const transport = http(rpcUrl);
  return createPublicClient({
    chain: await createChain(transport),
    transport,
    pollingInterval,
  });
}

async function getMasterAccount(client, index = 0) {
  const accounts = await client.request({ method: 'eth_accounts' });
  if (accounts == null || accounts.length === 0) {
    throw new Error(`Node doesn't support "eth_accounts"`);
  }
  return checksumAddress(accounts[index]);
}

// ==================== CREATE2 DEPLOYMENT ====================

async function deployCreateX(client) {
  const existingCode = await client.request({
    method: 'eth_getCode',
    params: [createXaddress, 'latest'],
  });
  if (existingCode === '0x') {
    console.log(`   Injecting CreateX at ${createXaddress}`);
    await client.request({
      method: 'hardhat_setCode',
      params: [createXaddress, CreateX_default.deployedBytecode],
    });
  }
}

async function getCreateX(client) {
  await deployCreateX(client);
  return getContract({
    abi: CreateX_default.abi,
    address: createXaddress,
    client,
  });
}

function getCreate2DeployAddress(
  metadata,
  ctrParams = [],
  salt = saltForBytecodeOnly
) {
  const bytecode = encodeDeployData({
    abi: metadata.abi,
    bytecode: metadata.bytecode,
    args: ctrParams,
  });
  const guardedSalt = keccak256(salt);
  return getCreate2Address({
    from: createXaddress,
    salt: guardedSalt,
    bytecode,
  });
}

async function create2deploy(
  client,
  metadata,
  ctrParams = [],
  salt = saltForBytecodeOnly
) {
  const chainId = await client.getChainId();
  try {
    const bytecode = encodeDeployData({
      abi: metadata.abi,
      bytecode: metadata.bytecode,
      args: ctrParams,
    });
    const createX = await getCreateX(client);
    const addr = getCreate2DeployAddress(metadata, ctrParams, salt);
    let existingCode = await client
      .extend(publicActions)
      .getCode({ address: addr });
    if (existingCode != null && existingCode !== '0x') {
      console.log(
        `   ${metadata.contractName} already deployed @ ${addr} on chain ${chainId}`
      );
      return addr;
    }
    await deployCreateX(client);
    const addr1 = await createX.read.deployCreate2([salt, bytecode]);
    if (addr != addr1) {
      throw new Error(
        `Internal error: computed address ${addr} but CreateX returned ${addr1}`
      );
    }
    await createX.write.deployCreate2([salt, bytecode], {
      gas: BigInt(30000000), // Ensure sufficient gas
    });
    console.log(
      `   Deployed ${metadata.contractName} @ ${addr} on chain ${chainId}`
    );
    return addr;
  } catch (error) {
    throw new Error(
      `Failed to deploy ${metadata.contractName} on chain ${chainId}`,
      { cause: error }
    );
  }
}

function getRuntimeVarsContractAddress() {
  const guardedSalt = keccak256(saltForBytecodeOnly);
  return getCreate2Address({
    from: createXaddress,
    salt: guardedSalt,
    bytecode: RuntimeVarsHelper_default.bytecode,
  });
}

// ==================== ENTRYPOINT DEPLOYMENT ====================

async function deployEntryPoint(client) {
  const chainId = await client.getChainId();
  const existingCode = await client.request({
    method: 'eth_getCode',
    params: [entryPoint09Address, 'latest'],
  });
  if (existingCode && existingCode !== '0x') {
    console.log(
      `   EntryPoint already exists at ${entryPoint09Address} on chain ${chainId}`
    );
    return entryPoint09Address;
  }
  const entryPointAddress = await create2deploy(client, EntryPoint_default);
  console.log(
    `   Deployed EntryPoint @ ${entryPointAddress} on chain ${chainId}`
  );
  if (entryPointAddress.toLowerCase() !== entryPoint09Address.toLowerCase()) {
    console.warn(
      `   ⚠️  EntryPoint at ${entryPointAddress}, not at SDK expected ${entryPoint09Address}`
    );
  }
  return entryPointAddress;
}

// ==================== MOCK BRIDGE DEPLOYMENT ====================

function getL1MockBridgeAddress(l2ChainId) {
  return getCreate2DeployAddress(MockL1Bridge_default, [l2ChainId]);
}

function getL2MockBridgeAddress() {
  return getCreate2DeployAddress(MockL2Bridge_default);
}

async function deployMockL1Bridges(l1Client, chains) {
  const networkChainId = BigInt(await l1Client.getChainId());
  const addresses = {};
  for (const chainId of chains) {
    const bridge = await create2deploy(l1Client, MockL1Bridge_default, [
      chainId,
    ]);
    if (bridge != getL1MockBridgeAddress(chainId)) {
      throw new Error('FATAL: Unexpected L1 bridge address');
    }
    addresses[chainId.toString()] = bridge;
  }
  return addresses;
}

async function deployL2Bridge(l2Client) {
  const networkChainId = BigInt(await l2Client.getChainId());
  const bridge = await create2deploy(l2Client, MockL2Bridge_default);
  if (bridge != getL2MockBridgeAddress()) {
    throw new Error('FATAL: Unexpected L2 bridge address');
  }
  return bridge;
}

// ==================== STAKE MANAGER DEPLOYMENT ====================

async function deployStakeManager(client, entryPointAddr) {
  const owner = client.account?.address;
  if (owner == null) {
    throw new Error(
      'Wallet client missing default account for stake manager owner'
    );
  }
  const chainId = BigInt(await client.getChainId());
  const config = {
    claimDelay: 8n * 24n * 60n * 60n,
    destBeforeOriginMinGap: 10n,
    minStakePerChain: parseEther('0.01'),
    unstakeDelay: 3600n,
    maxChainsPerXlp: 10n,
    l2SlashedGasLimit: 1000001n,
    l2StakedGasLimit: 1000000n,
    owner,
  };
  const stakeManagerAddress = await create2deploy(
    client,
    L1AtomicSwapStakeManager_default,
    [{ ...config }]
  );
  return stakeManagerAddress;
}

// ==================== PAYMASTER DEPLOYMENT ====================

async function deployPaymaster(client, entryPointAddr, options) {
  const chainId = options?.chainId ?? BigInt(await client.getChainId());
  const l2Connector = options?.l2Connector ?? zeroAddress;
  const l1Connector = options?.l1Connector ?? zeroAddress;
  const l1StakeManager = options?.l1StakeManager ?? zeroAddress;
  const postOpGasCost = options?.postOpGasCost ?? 100000n;
  const destinationL1SlashGasLimit = options?.destinationL1SlashGasLimit ?? 0n;
  const originL1DisputeGasLimit = options?.originL1DisputeGasLimit ?? 0n;
  const disputeBondPercent = options?.disputeBondPercent ?? 10n;
  const flatNativeBond = options?.flatNativeBond ?? parseEther('0.1');

  const destinationModuleAddress = await create2deploy(
    client,
    DestinationSwapDisputeManager_default,
    [l2Connector, l1Connector, entryPointAddr, destinationL1SlashGasLimit]
  );

  const originDisputeModuleAddress = await create2deploy(
    client,
    OriginationSwapDisputeManager_default,
    [
      3600n,
      3600n,
      l2Connector,
      l1Connector,
      l1StakeManager,
      3600n,
      3700n,
      disputeBondPercent,
      flatNativeBond,
      originL1DisputeGasLimit,
    ]
  );

  const originSwapModuleAddress = await create2deploy(
    client,
    OriginSwapManager_default,
    [
      3600n,
      3600n,
      3600n,
      3700n,
      disputeBondPercent,
      flatNativeBond,
      originDisputeModuleAddress,
      originL1DisputeGasLimit,
    ]
  );

  const owner = client.account.address;
  const paymasterAddress = await create2deploy(
    client,
    CrossChainPaymaster_default,
    [
      entryPointAddr,
      zeroAddress, // l2Connector
      zeroAddress, // l1Connector
      zeroAddress, // l1StakeManager
      100000n, // postOpGasCost
      0n, // destinationL1SlashGasLimit
      destinationModuleAddress, // destinationDisputeModule
      originSwapModuleAddress, // originSwapModule
      owner, // owner
    ]
  );
  return paymasterAddress;
}

// ==================== RUNTIME VARS HELPER DEPLOYMENT ====================

async function deployRuntimeVarsHelperContract(client) {
  await deployCreateX(client);
  const runtimeVarsAddress = getRuntimeVarsContractAddress();
  if (
    (await client
      .extend(publicActions)
      .getCode({ address: runtimeVarsAddress })) == null
  ) {
    const deployAddress = await create2deploy(
      client,
      RuntimeVarsHelper_default
    );
    if (deployAddress != runtimeVarsAddress) {
      throw new Error(
        `FATAL: RuntimeVars contract deployed at ${deployAddress}, but expected at ${runtimeVarsAddress}`
      );
    }
  }
}

// ==================== SIMPLE PAYMASTER DEPLOYMENT ====================

async function deploySimplePaymaster(walletClient, entryPointAddr) {
  return await create2deploy(walletClient, SimplePaymaster_default, [
    entryPointAddr,
    sourcePaymasterOwner,
  ]);
}

// ==================== XLP HELPER DEPLOYMENT ====================

async function deployXlpSelectionHelper(walletClient) {
  return await create2deploy(walletClient, XlpSelectionHelper_default);
}

// ==================== SIMPLE ACCOUNT FACTORY DEPLOYMENT ====================

async function deploySimpleAccountFactory(walletClient, entryPointAddr) {
  return await create2deploy(walletClient, SimpleAccountFactory_default, [
    entryPointAddr,
  ]);
}

// ==================== TEST TOKEN DEPLOYMENT ====================

async function deployTestToken(walletClient, name, symbol, decimals) {
  return await create2deploy(walletClient, TestERC20_default, [
    name,
    symbol,
    decimals,
  ]);
}

async function deployTestTokens(walletClient) {
  const tokens = {};
  tokens.USDC = await deployTestToken(walletClient, 'USD Coin', 'USDC', 6);
  console.log(`   TestERC20 USDC: ${tokens.USDC}`);
  tokens.WETH = await deployTestToken(
    walletClient,
    'Wrapped Ether',
    'WETH',
    18
  );
  console.log(`   TestERC20 WETH: ${tokens.WETH}`);
  tokens.USDT = await deployTestToken(walletClient, 'Tether USD', 'USDT', 6);
  console.log(`   TestERC20 USDT: ${tokens.USDT}`);
  tokens.DAI = await deployTestToken(walletClient, 'Dai Stablecoin', 'DAI', 18);
  console.log(`   TestERC20 DAI: ${tokens.DAI}`);
  return tokens;
}

// ==================== CLIENT CREATION FOR DEPLOYMENT ====================

async function getClientsForDeployment(url) {
  const publicClient = await createPublicClientFromUrl(url);
  const deployerKey = process.env.PRIVATE_KEY;
  let walletClient;
  let account;
  
  // For local Anvil chains, always use the master account (more reliable)
  // since private keys may not match expected addresses
  try {
    account = toAccount(await getMasterAccount(publicClient));
    console.log(`📌 Using master account from node: ${account.address}`);
  } catch (e) {
    // Fallback to private key if master account not available
    if (deployerKey == null) {
      throw new Error('No private key provided and node does not support eth_accounts');
    }
    account = privateKeyToAccount('0x' + deployerKey);
    console.log(`📌 Using account from private key: ${account.address}`);
  }
  
  walletClient = await createWalletClientFromUrl(url, account);
  
  // Verify account has balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Account balance: ${balance} wei (${Number(balance) / 1e18} ETH)`);
  if (balance === 0n) {
    throw new Error(`❌ Account ${account.address} has 0 balance! Cannot deploy.`);
  }
  return { publicClient, walletClient };
}

// ==================== CHAIN CONTRACT DEPLOYMENT ====================

async function deployChainContractsWithURL(
  url,
  l1StakeManager,
  deployedL1Connectors
) {
  const { walletClient } = await getClientsForDeployment(url);
  const deployment = await deployChainContracts(
    walletClient,
    l1StakeManager,
    deployedL1Connectors
  );
  deployment.nodeUrl = deployment.nodeUrl || url;
  const chainId = deployment.chainId;
  
  // Set bundler URLs
  const bundlerPortMap = {
    42161: 3000, // Arbitrum
    10: 3001,    // Optimism
  };
  const bundlerPort = bundlerPortMap[chainId];
  if (bundlerPort) {
    deployment.bundlerUrl = `http://localhost:${bundlerPort}/rpc`;
  }
  
  return deployment;
}

async function deployChainContracts(
  walletClient,
  l1StakeManager,
  deployedL1Connectors
) {
  const publicClient = walletClient.extend(publicActions);
  const chainId = await publicClient.getChainId();
  const chainIdKey = BigInt(chainId).toString();

  console.log(`\n🔗 Deploying EIL contracts on chain ${chainId}...`);

  // Deploy EntryPoint
  const entryPointAddr = await deployEntryPoint(walletClient);
  console.log(`   EntryPoint: ${entryPointAddr}`);

  const xlpSelectionHelper = await deployXlpSelectionHelper(walletClient);
  console.log(`   XlpSelectionHelper: ${xlpSelectionHelper}`);

  let sourcePaymaster = zeroAddress;
  try {
    const account = await getMasterAccount(publicClient);
    sourcePaymaster = await deploySimplePaymaster(walletClient, entryPointAddr);
    console.log(`   SimplePaymaster: ${sourcePaymaster}`);
    const amount = parseEther('1');
    const bal = await publicClient.getBalance({ address: sourcePaymaster });
    if (amount < bal / 2n) {
      await walletClient.sendTransaction({
        account,
        to: sourcePaymaster,
        value: amount,
      });
    }
  } catch {
    // Ignore errors for simple paymaster funding
  }

  // Deploy SimpleAccountFactory
  const accountFactory = await deploySimpleAccountFactory(
    walletClient,
    entryPointAddr
  );
  console.log(`   SimpleAccountFactory: ${accountFactory}`);

  // Deploy bridges
  // For simplicity, deploy mock L2 bridge on each chain
  const l2Bridge = await deployL2Bridge(walletClient);
  const l2Connector = getL2MockBridgeAddress();
  console.log(`   MockL2Bridge: ${l2Bridge}`);

  // L1 connector is the mock L1 bridge address
  const l1ConnectorAddress = deployedL1Connectors[chainIdKey];

  // Deploy paymaster
  const paymaster = await deployPaymaster(walletClient, entryPointAddr, {
    chainId: BigInt(chainId),
    l2Connector: l2Connector ?? zeroAddress,
    l1Connector: l1ConnectorAddress ?? zeroAddress,
    l1StakeManager: l1StakeManager ?? zeroAddress,
  });
  console.log(`   CrossChainPaymaster: ${paymaster}`);

  // Deposit to EntryPoint
  const epContract = getContract({
    address: entryPointAddr,
    abi: entryPoint08Abi,
    client: walletClient,
  });
  const depositEth = process.env.EP_DEPOSIT_ETH ?? '0.1';
  const depositAmount = parseEther(depositEth);
  const currentDeposit = await epContract.read.balanceOf([paymaster]);
  if (currentDeposit < depositAmount / 2n) {
    await epContract.write.depositTo([paymaster], {
      value: depositAmount,
      account: walletClient.account,
    });
    console.log(`   Deposited ${depositEth} ETH to EntryPoint for paymaster`);
  }

  await deployRuntimeVarsHelperContract(walletClient);

  // Deploy test tokens
  console.log(`\n   Deploying test tokens on chain ${chainId}...`);
  const tokens = await deployTestTokens(walletClient);

  return {
    chainId,
    nodeUrl: '',
    bundlerUrl: '',
    l2Bridge,
    l2Connector,
    paymaster,
    sourcePaymaster,
    xlpSelectionHelper,
    stakeManager: l1StakeManager,
    accountFactory,
    entryPoint: entryPointAddr,
    tokens,
  };
}

// ==================== MAIN DEPLOYMENT FUNCTION ====================

async function deployContracts() {
  console.log('\n🚀 EIL Demo - 2 Chain Deployment (Arbitrum + Optimism)\n');
  console.log(`   EntryPoint address: ${entryPoint09Address}`);
  console.log(`   CreateX address: ${createXaddress}`);
  console.log('');

  const arbRpc = getEnv('ARB_RPC');
  const opRpc = getEnv('OP_RPC');

  console.log(`   Arbitrum RPC: ${arbRpc}`);
  console.log(`   Optimism RPC: ${opRpc}`);
  console.log('');

  // Deploy to Arbitrum first (using it as "L1" for stake manager)
  const deployedL1Connectors = {};
  
  // Deploy contracts on both chains
  const arbDeployment = await deployChainContractsWithURL(
    arbRpc,
    undefined,
    deployedL1Connectors
  );
  const deployments = [arbDeployment];

  // Deploy Optimism
  const opDeployment = await deployChainContractsWithURL(
    opRpc,
    arbDeployment.stakeManager,
    deployedL1Connectors
  );
  deployments.push(opDeployment);

  const deploymentFile = getEnv('DEPLOYMENT_FILE', './deployment.json');
  const resolvedDeploymentFile = resolve(__dirname, '..', deploymentFile);
  console.log('\n📄 Writing deployment to', resolvedDeploymentFile);
  writeDeploymentFile(resolvedDeploymentFile, deployments);

  console.log('\n✅ EIL Demo deployment complete!\n');
  return deployments;
}

// ==================== ENTRY POINT ====================

console.log('🔧 Deploying EIL Demo contracts...');
deployContracts().catch((e) => {
  console.error('❌ Error deploying contracts:', e);
  process.exit(1);
});

export { deployContracts };
