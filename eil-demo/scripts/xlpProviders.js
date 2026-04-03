/**
 * Mock providers script for EIL Protocol.
 *
 * This file contains the logic required to run mock XLP providers for EIL SDK testing.
 *
 * Key differences from chain-abstraction providers:
 * - Uses @eil-protocol/contracts artifacts via contractArtifacts.js
 * - Compatible with EIL SDK's expected contract interfaces
 */

// ==================== IMPORTS ====================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  getContract,
  getCreate2Address,
  encodeDeployData,
  encodeFunctionData,
  decodeFunctionResult,
  decodeEventLog,
  keccak256,
  padHex,
  toHex,
  checksumAddress,
  zeroAddress,
  maxUint256,
  publicActions,
  walletActions,
  isHex,
  erc20Abi,
  toEventSelector,
  sliceHex,
  stringToHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Import contract artifacts from EIL artifacts file
import {
  CreateX_default,
  MockL1Bridge_default,
  MockL2Bridge_default,
  ICrossChainPaymaster_default,
  AtomicSwapTypes_default,
  TestERC20_default,
} from './contractArtifacts.js';

// ==================== CONSTANTS ====================
const createXaddress = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
const saltForBytecodeOnly = padHex('0x1', { size: 32 });

const LOCAL_CHAIN_IDS = new Set([
  1337n, // common dev chain id
  31337n, // hardhat
  31338n,
  31339n,
]);

// Load token addresses from deployment.json
function loadTokensFromDeployments() {
  const deploymentFile = process.env.DEPLOYMENT_FILE
    ? resolve(__dirname, process.env.DEPLOYMENT_FILE)
    : resolve(__dirname, '..', 'deployment.json');

  if (!existsSync(deploymentFile)) {
    console.warn(`Deployment file not found: ${deploymentFile}`);
    return {};
  }

  const deployments = JSON.parse(readFileSync(deploymentFile, 'utf8'));
  const tokens = { USDC: [], WETH: [], USDT: [], DAI: [] };

  for (const deployment of deployments) {
    if (deployment.tokens) {
      const chainId = deployment.chainId;
      if (deployment.tokens.USDC) {
        tokens.USDC.push({ chainId, address: deployment.tokens.USDC });
      }
      if (deployment.tokens.WETH) {
        tokens.WETH.push({ chainId, address: deployment.tokens.WETH });
      }
      if (deployment.tokens.USDT) {
        tokens.USDT.push({ chainId, address: deployment.tokens.USDT });
      }
      if (deployment.tokens.DAI) {
        tokens.DAI.push({ chainId, address: deployment.tokens.DAI });
      }
    }
  }

  console.log(`Loaded tokens from ${deploymentFile}:`);
  for (const [name, addrs] of Object.entries(tokens)) {
    if (addrs.length > 0) {
      console.log(
        `   ${name}: ${addrs
          .map((a) => `${a.chainId}:${a.address}`)
          .join(', ')}`
      );
    }
  }

  return tokens;
}

// ==================== UTILITY FUNCTIONS ====================

function getEnv(name, defaultVal) {
  if (process.env[name] == null) {
    if (defaultVal != null) {
      return defaultVal;
    }
    throw new Error(`Environment ${name} not found`);
  }
  return process.env[name];
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isPublicChain(chainId) {
  if (chainId == null) {
    return true;
  }
  return !LOCAL_CHAIN_IDS.has(chainId);
}

// ==================== DEPLOYMENT FILE ====================

function readDeploymentFile(fileName) {
  if (!existsSync(fileName)) {
    throw new Error(`Deployment file not found: ${fileName}`);
  }
  return JSON.parse(readFileSync(fileName, 'utf8'));
}

function getDeployment(fileName, chainId) {
  const deployments = readDeploymentFile(fileName);
  const deployment = deployments.find((d) => d.chainId === chainId);
  if (!deployment) {
    throw new Error(
      `Deployment not found for chain ${chainId} in file ${fileName}`
    );
  }
  return deployment;
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

// ==================== CONTRACT WRAPPERS ====================

function getICrossChainPaymaster(client, address) {
  return getContract({
    abi: ICrossChainPaymaster_default.abi,
    address,
    client,
  });
}

function getTestErc20Token(client, address) {
  return getContract({
    abi: TestERC20_default.abi,
    address,
    client,
  });
}

// ==================== MULTICHAIN TYPES ====================

class MultiChainEntity {
  _addressOn(chainId, strictMode) {
    throw new Error('Method not implemented');
  }
  addressOn(chainId, strictMode) {
    return this._addressOn(chainId, strictMode);
  }
}

function toAddress(chainId, addr, strictMode) {
  if (typeof addr === 'string') {
    return addr;
  }
  if ('addressOn' in addr) {
    return addr.addressOn(chainId, strictMode);
  }
  if ('address' in addr) {
    return addr.address;
  }
  if (strictMode) {
    throw new Error(
      'Invalid address type provided. Must be Address, MultiChainEntity, or Account.'
    );
  }
  return undefined;
}

class MultichainClient {
  clients = new Map();
  constructor(publicClients = []) {
    for (const client of publicClients) {
      this.addClientWithChainId(client, BigInt(client.chain.id));
    }
  }
  all() {
    return Array.from(this.clients.values());
  }
  async addClient(client) {
    const chainId = BigInt(await client.getChainId());
    this.addClientWithChainId(client, chainId);
  }
  addClientWithChainId(client, chainId) {
    if (this.clients.has(chainId)) {
      throw new Error(`Client already exists for chainId: ${chainId}`);
    }
    this.clients.set(chainId, client);
  }
  on(chainId) {
    if (!this.clients.has(chainId)) {
      throw new Error(
        `No client found for chainId: ${chainId}. Supported chains: ${Array.from(
          this.clients.keys()
        ).join(', ')}`
      );
    }
    return this.clients.get(chainId);
  }
  async call({ chainId, to, abi, functionName, args, value }) {
    const client = this.on(chainId);
    const data = encodeFunctionData({ abi, functionName, args });
    const valueHex = value ? toHex(value) : undefined;
    const ret = await client.request({
      method: 'eth_call',
      params: [{ to, data, value: valueHex }, 'latest'],
    });
    return decodeFunctionResult({ abi, functionName, data: ret });
  }
}

class MultichainContract extends MultiChainEntity {
  constructor(client, abi, deployments = []) {
    super();
    this.client = client;
    this.abi = abi;
    if (!Array.isArray(deployments)) {
      if (!isHex(deployments)) {
        throw new Error(
          `deployment address is either array or specific address`
        );
      }
      this.defaultAddr = deployments;
    } else {
      for (const entry of deployments) {
        if (Array.isArray(entry)) {
          const [chainId, address] = entry;
          this.addAddress(BigInt(chainId), address);
        } else {
          const { chainId, address } = entry;
          this.addAddress(BigInt(chainId), address);
        }
      }
    }
  }
  deployments = new Map();
  defaultAddr;
  static isMultichainContract(obj) {
    return typeof obj.addressOn === 'function';
  }
  addAddress(chainId, address) {
    if (this.deployments.has(chainId)) {
      throw new Error(`Address already exists for chainId: ${chainId}`);
    }
    this.deployments.set(chainId, address);
  }
  _addressOn(chainId, strictMode) {
    if (!this.deployments.has(chainId) && !this.defaultAddr) {
      if (strictMode !== false) {
        throw new Error(
          `MultiChainEntity does not have an address on chain ${chainId}`
        );
      }
      return undefined;
    }
    return this.deployments.get(chainId) ?? this.defaultAddr;
  }
  encodeFunctionData(functionName, args) {
    return encodeFunctionData({ abi: this.abi, functionName, args });
  }
  decodeFunctionResult(functionName, data) {
    return decodeFunctionResult({ abi: this.abi, functionName, data });
  }
  async call(chainId, functionName, args, callOptions = {}) {
    const client = this.client.on(chainId);
    const data = this.encodeFunctionData(functionName, args);
    const ret = await client.call({
      to: this.addressOn(chainId),
      data,
      ...callOptions,
    });
    return this.decodeFunctionResult(functionName, ret.data);
  }
}

class MultichainToken extends MultichainContract {
  constructor(client, deployments) {
    super(client, erc20Abi, deployments);
  }
  async balanceOf(chainId, address) {
    return this.call(chainId, 'balanceOf', [toAddress(chainId, address)]);
  }
  async symbol(chainId) {
    return this.call(chainId, 'symbol', []);
  }
  async decimals(chainId) {
    return this.call(chainId, 'decimals', []);
  }
  async allowance(chainId, owner, spender) {
    return this.call(chainId, 'allowance', [
      toAddress(chainId, owner),
      toAddress(chainId, spender),
    ]);
  }
}

// ==================== EVENTS POLLER ====================

class EventsPoller {
  constructor(params) {
    this.params = params;
    const { abi, eventNames } = params;
    this.eventAbis = abi.filter(
      (x) => x.type === 'event' && eventNames.includes(x.name)
    );
    if (this.eventAbis.length !== eventNames.length) {
      throw new Error(`Event names "${eventNames}" not found in contract ABI.`);
    }
    this.topics = this.eventAbis.map((abi) => toEventSelector(abi));
    void this.pollEvents().catch((e) => {
      console.error('pollEvents:', e);
    });
  }
  eventAbis;
  topics;
  stopped = false;
  async pollEvents() {
    const {
      client,
      eventNames,
      onLog,
      pollInterval = 1000,
      fromBlock,
    } = this.params;
    let lastBlock = fromBlock ?? (await client.getBlockNumber()) - 1n;
    let interval = 200;
    while (!this.stopped) {
      await new Promise((r) => setTimeout(r, interval));
      interval = Math.min(interval * 2, pollInterval);
      const latestBlock = await client.getBlockNumber();
      if (latestBlock <= lastBlock) continue;
      const fromBlock2 = lastBlock + 1n;
      const toBlock = latestBlock;
      const logs = await client.getLogs({
        fromBlock: fromBlock2,
        toBlock,
      });
      for (const log of logs) {
        try {
          if (log.topics[0] == null || !this.topics.includes(log.topics[0])) {
            continue;
          }
          const decoded = decodeEventLog({
            abi: this.eventAbis,
            data: log.data,
            topics: log.topics,
          });
          if (!eventNames.includes(decoded.eventName)) {
            continue;
          }
          await onLog({
            ...log,
            args: decoded.args,
            eventName: decoded.eventName,
          });
        } catch {
          console.warn(`${eventNames}: ignored event topic`, log.topics[0]);
        }
      }
      lastBlock = latestBlock;
    }
  }
  stopEventPoller() {
    this.stopped = true;
  }
}

// ==================== CREATE2 DEPLOYMENT ====================

async function deployCreateX(client) {
  const existingCode = await client.request({
    method: 'eth_getCode',
    params: [createXaddress, 'latest'],
  });
  if (existingCode === '0x') {
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
    const existingCode = await client
      .extend(publicActions)
      .getCode({ address: addr });
    if (existingCode != null && existingCode !== '0x') {
      return addr;
    }
    await deployCreateX(client);
    const addr1 = await createX.read.deployCreate2([salt, bytecode]);
    if (addr !== addr1) {
      throw new Error(
        `Internal error: computed address ${addr} but CreateX returned ${addr1}`
      );
    }
    await createX.write.deployCreate2([salt, bytecode]);
    console.log(
      `Deployed ${metadata.contractName} @ ${addr} on chain ${chainId}`
    );
    return addr;
  } catch (error) {
    throw new Error(
      `Failed to deploy ${metadata.contractName} on chain ${chainId}`,
      { cause: error }
    );
  }
}

// ==================== CONFIRMATION ====================

async function confirmPublicDeployment(
  chainId,
  action,
  params,
  skipConfirmation = false
) {
  if (
    skipConfirmation ||
    (process.env.CONFIRM_DEPLOYMENTS ?? '').toLowerCase() === 'false'
  ) {
    return;
  }
  if (!isPublicChain(chainId)) {
    return;
  }
  console.log(
    `\n⚠️  About to execute on chain ${chainId ?? 'unknown'}: ${action}`
  );
  const entries = Object.entries(params);
  if (entries.length > 0) {
    for (const [key, value] of entries) {
      console.log(`  • ${key}: ${value}`);
    }
  }
  const rl = readline.createInterface({ input, output });
  while (true) {
    const answer = ('').trim().toLowerCase();
    if (answer === '' || answer === 'y' || answer === 'yes') {
      console.log('Proceeding...\n');
      break;
    }
    if (answer === 'n' || answer === 'no') {
      rl.close();
      throw new Error('Deployment aborted by user');
    }
    console.log('Please respond with "y" to proceed or "n" to abort.');
  }
  rl.close();
}

// ==================== MOCK BRIDGES ====================

function getL1MockBridgeAddress(l2ChainId) {
  return getCreate2DeployAddress(MockL1Bridge_default, [l2ChainId]);
}

function getL2MockBridgeAddress() {
  return getCreate2DeployAddress(MockL2Bridge_default);
}

async function getL2MockBridgeContract(l2Client) {
  const address = getL2MockBridgeAddress();
  if ((await l2Client.extend(publicActions).getCode({ address })) == null) {
    await deployL2Bridge(l2Client, true);
  }
  return getContract({
    address,
    abi: MockL2Bridge_default.abi,
    client: l2Client,
  });
}

async function getL1MockBridgeContract(l1Client, l2ChainId) {
  const address = getL1MockBridgeAddress(l2ChainId);
  if ((await l1Client.extend(publicActions).getCode({ address })) == null) {
    await deployMockL1Bridges(l1Client, [l2ChainId]);
  }
  return getContract({
    address,
    abi: MockL1Bridge_default.abi,
    client: l1Client,
  });
}

async function deployMockL1Bridges(l1Client, chains) {
  const networkChainId = BigInt(await l1Client.getChainId());
  const addresses = {};
  for (const chainId of chains) {
    await confirmPublicDeployment(networkChainId, 'Deploy MockL1Bridge', {
      targetL2ChainId: chainId,
    });
    const bridge = await create2deploy(l1Client, MockL1Bridge_default, [
      chainId,
    ]);
    if (bridge !== getL1MockBridgeAddress(chainId)) {
      throw new Error('FATAL: Unexpected L1 bridge address');
    }
    addresses[chainId.toString()] = bridge;
  }
  return addresses;
}

async function deployL2Bridge(l2Client, skipConfirmation = false) {
  const networkChainId = BigInt(await l2Client.getChainId());
  await confirmPublicDeployment(
    networkChainId,
    'Deploy MockL2Bridge',
    {},
    skipConfirmation
  );
  const bridge = await create2deploy(l2Client, MockL2Bridge_default);
  if (bridge !== getL2MockBridgeAddress()) {
    throw new Error('FATAL: Unexpected L2 bridge address');
  }
  return bridge;
}

// ==================== TOKEN BALANCE ====================

async function setEthBalance(accountAddress, amountUnits, rpcUrl) {
  const client = await createPublicClientFromUrl(rpcUrl);
  const amountWei = parseUnits(amountUnits, 18);
  await client.request({
    method: 'hardhat_setBalance',
    params: [accountAddress, toHex(amountWei)],
  });
  console.log(
    `Set balance of ${accountAddress} to ${formatEther(amountWei)} ETH`
  );
}

// Use TestERC20's sudoMint for local test tokens
async function mintTestToken(publicClient, tokenAddress, recipient, amount) {
  const chainId = BigInt(await publicClient.getChainId());
  const masterAccount = await getMasterAccount(publicClient);

  // Call sudoMint on the TestERC20 contract
  const mintTx = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'sudoMint',
        inputs: [
          { type: 'address', name: '_to' },
          { type: 'uint256', name: '_amount' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'sudoMint',
    args: [recipient, amount],
  });

  const hash = await publicClient.extend(walletActions).sendTransaction({
    account: masterAccount,
    to: tokenAddress,
    data: mintTx,
    chain: publicClient.chain,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Minted ${amount} tokens to ${recipient} on chain ${chainId}`);
}

async function mintAndDepositToXlp(
  publicClient,
  paymasterAddress,
  providerAddress,
  token,
  amount
) {
  const chainId = BigInt(await publicClient.getChainId());
  const masterAccount = await getMasterAccount(publicClient);
  const tokenAddress = toAddress(chainId, token);
  const paymaster = getICrossChainPaymaster(publicClient, paymasterAddress);
  const tokenContract = getTestErc20Token(publicClient, tokenAddress);

  // Check if already deposited
  const currentDeposit = await paymaster.read.tokenBalanceOf([
    tokenAddress,
    providerAddress,
  ]);
  if (currentDeposit > amount / 2n) {
    console.log(`Current deposit ${currentDeposit}. NOT minting more.`);
    return;
  }

  // Mint test tokens to master account, then approve and deposit to XLP
  await mintTestToken(publicClient, tokenAddress, masterAccount, amount);
  await tokenContract.write.approve([paymasterAddress, amount], {
    account: masterAccount,
  });
  await paymaster.write.tokenDepositToXlp(
    [tokenAddress, providerAddress, amount],
    { account: masterAccount }
  );
  console.log(
    `Deposited ${amount} tokens to XLP ${providerAddress} on chain ${chainId}`
  );
}

// ==================== VOUCHER SIGNING ====================

const EmptyVoucher = {
  voucherRequestDest: {
    chainId: 0n,
    sender: zeroAddress,
    paymaster: zeroAddress,
    assets: [],
    maxUserOpCost: 0n,
    expiresAt: 0n,
  },
  requestId: `0x${'00'.repeat(32)}`,
  originationXlpAddress: zeroAddress,
  expiresAt: maxUint256,
  xlpSignature: '0x',
  voucherType: 0,
};

async function signAtomicSwapVoucher(signer, voucher, voucherRequest) {
  const message = encodeForSigning(voucher, voucherRequest);
  return await signer.signMessage({ message: { raw: message } });
}

function encodeForSigning(voucher, voucherRequest) {
  const data = encodeFunctionData({
    abi: AtomicSwapTypes_default.abi,
    functionName: 'getDataForVoucherSignature',
    args: [
      voucherRequest.destination,
      voucher.requestId,
      voucher.originationXlpAddress,
      voucher.expiresAt,
      voucher.voucherType,
    ],
  });
  return sliceHex(data, 4);
}

// ==================== MOCK BRIDGE CLASS ====================

class MockBridge {
  constructor(l1Wallet, l2Wallet) {
    this.l1Wallet = l1Wallet;
    this.l2Wallet = l2Wallet;
  }
  _unwatchL1;
  _unwatchL2;
  static async create(l1Wallet, l2Wallet) {
    const bridge = new MockBridge(l1Wallet, l2Wallet);
    await bridge.initialize();
    return bridge;
  }
  async initialize() {
    const l2ChainId = await this.l2Wallet.getChainId();
    const l1Bridge = await getL1MockBridgeContract(
      this.l1Wallet,
      BigInt(l2ChainId)
    );
    const l2Bridge = await getL2MockBridgeContract(this.l2Wallet);
    console.log(
      `Watching L1 bridge at ${
        l1Bridge.address
      } @ ${await this.l1Wallet.getChainId()}\n      and L2 bridge at ${
        l2Bridge.address
      } @ ${l2ChainId}`
    );
    this._unwatchL1 = l1Bridge.watchEvent.MockMessageSentToL2(
      {},
      {
        onLogs: async (logs) => {
          try {
            for (const log of logs) {
              await l2Bridge.write.debugOnMessageFromL1([
                log.args.sender,
                log.args.destination,
                log.args.data,
              ]);
            }
          } catch (e) {
            console.error('⚠️ MockBridge: error handling event', e);
          }
        },
      }
    );
    this._unwatchL2 = l2Bridge.watchEvent.MessageSentToL1(
      {},
      {
        onLogs: async (logs) => {
          try {
            for (const log of logs) {
              await l1Bridge.write.debugOnMessageFromL2([
                log.args.sender,
                log.args.destination,
                log.args.data,
              ]);
            }
          } catch (e) {
            console.error('⚠️ MockBridge: error handling event', e);
          }
        },
      }
    );
  }
  stop() {
    console.log(`Stopping MockBridge to chain ${this.l2Wallet.chain.id}`);
    this._unwatchL1();
    this._unwatchL2();
  }
}

// ==================== MOCK LIQUIDITY PROVIDER CLASS ====================

class MockLiquidityProvider {
  constructor(xlpAccount, sourcePaymaster, xlpVoucherSigner = xlpAccount) {
    this.xlpAccount = xlpAccount;
    this.sourcePaymaster = sourcePaymaster;
    this.xlpVoucherSigner = xlpVoucherSigner;
  }
  eventPoller;
  static async create(
    xlpAccount,
    sourcePaymaster,
    xlpVoucherSigner = xlpAccount,
    pollInterval = 2000
  ) {
    const prov = new MockLiquidityProvider(
      xlpAccount,
      sourcePaymaster,
      xlpVoucherSigner
    );
    await prov.init(pollInterval);
    return prov;
  }
  done() {
    console.log('MockProvider: done');
    this.eventPoller?.stopEventPoller();
  }
  async init(pollInterval = 2000) {
    const { xlpAccount, xlpVoucherSigner, sourcePaymaster } = this;
    const xlpAddr = xlpVoucherSigner.account.address;
    const paymaster = getICrossChainPaymaster(
      this.xlpAccount,
      this.sourcePaymaster
    );
    xlpAccount.getChainId().then(async (chainId) => {
      const code = await xlpAccount
        .extend(publicActions)
        .getCode({ address: this.sourcePaymaster });
      if (code == null) {
        throw new Error(
          `paymaster ${sourcePaymaster} not deployed on chain ${chainId}`
        );
      }
      try {
        await paymaster.read.getXlpByL2Address([xlpAddr]);
      } catch {
        const l1Connector = await paymaster.read.l1Connector();
        if (l1Connector !== zeroAddress) {
          throw new Error('mock provider not registered');
        }
        await paymaster.write.onL1XlpChainInfoAdded([xlpAddr, xlpAddr]);
      }
      const nativeBalance = parseEther('1');
      if (
        (await paymaster.read.nativeBalanceOf([xlpAddr])) <
        nativeBalance / 2n
      ) {
        await paymaster.write.depositToXlp([xlpAddr], { value: nativeBalance });
      }
      const xlps = await paymaster.read.getXlps([0n, 100n]);
      if (
        xlps.find(
          (x) => x.l2XlpAddress.toLowerCase() === xlpAddr.toLowerCase()
        ) == null
      ) {
        throw new Error(
          `XLP ${xlpAddr} is not registered on paymaster ${sourcePaymaster}`
        );
      }
      console.log(
        `👀 MockProvider ${xlpAddr}: watching VoucherRequestCreated on ${this.sourcePaymaster} chainId=${chainId}`
      );
    });
    this.eventPoller = new EventsPoller({
      client: xlpAccount.extend(publicActions),
      abi: paymaster.abi,
      eventNames: ['VoucherRequestCreated'],
      pollInterval,
      onLog: async (log) => {
        try {
          if (log.eventName !== 'VoucherRequestCreated') {
            console.log('VoucherRequestCreated: ignore', log.eventName);
            return;
          }
          const requestId = log.args.id;
          const voucherRequest = log.args.voucherRequest;
          const xlpAddress = checksumAddress(
            this.xlpVoucherSigner.account.address
          );
          const now = nowSeconds();
          const expiresAt = BigInt(
            Math.max(Number(voucherRequest.destination.expiresAt), now + 7200)
          );
          if (
            voucherRequest.origination.allowedXlps.find(
              (addr) => addr.toLowerCase() === xlpAddr.toLowerCase()
            ) == null
          ) {
            console.log(
              `MockProvider: ignore request. ${xlpAddress} not in allowed Xlps ${voucherRequest.origination.allowedXlps}`
            );
            return;
          }
          const voucher = {
            requestId,
            voucherRequestDest: voucherRequest.destination,
            originationXlpAddress: xlpAddress,
            expiresAt,
            voucherType: 0,
            xlpSignature: '0x',
          };
          voucher.xlpSignature = await signAtomicSwapVoucher(
            xlpVoucherSigner,
            voucher,
            voucherRequest
          );
          try {
            await paymaster.write.issueVouchers([
              [{ voucherRequest, voucher }],
            ]);
            const { sender, senderNonce } = voucherRequest.origination;
            console.log(
              '💸 MockProvider: voucher issued',
              `${sender}/${senderNonce}`,
              voucher.requestId,
              'on chain',
              xlpAccount.chain?.id
            );
            console.log(
              ' - token amounts:',
              voucherRequest.destination.assets.map(
                (t) => `${t.erc20Token}: ${t.amount}`
              )
            );
          } catch (e) {
            console.error('⚠️ MockProvider: issueVoucher error:', e.cause);
          }
        } catch (e) {
          console.error(
            '⚠️ MockProvider: error handling VoucherRequestCreated',
            e
          );
        }
      },
    });
  }
}

// ==================== ADD LIQUIDITY ====================

async function addTokensLiquidity(tokens, client, xlp, paymaster) {
  const mcClient = new MultichainClient([client]);
  const chainId = await client.getChainId();
  for (const tokenName of Object.keys(tokens)) {
    const mcToken = new MultichainToken(mcClient, tokens[tokenName]);
    if (mcToken.addressOn(BigInt(chainId)) == null) {
      console.warn(
        `⚠️ No token ${tokenName} address for chain ${chainId}, skipping`
      );
      continue;
    }
    console.log(
      `💰 Adding liquidity for token ${tokenName} on chain ${chainId} to address ${xlp}`
    );
    await mintAndDepositToXlp(
      client,
      paymaster,
      xlp,
      mcToken,
      parseEther('10000')
    );
  }
}

// ==================== MAIN FUNCTION ====================

// Resolve deployment file path relative to script directory
const deploymentFile = process.env.DEPLOYMENT_FILE
  ? resolve(__dirname, process.env.DEPLOYMENT_FILE)
  : null;
const providerPrivateKey = keccak256(stringToHex('test-mock-provider'));

async function startMockProviders() {
  console.log('Starting EIL mock providers...');
  const keys = Object.keys(process.env).sort();
  const l1NetworkUrl = getEnv('URL_ETH');
  const networkUrls = keys
    .filter((key) => key.startsWith('URL_'))
    .map((key) => process.env[key]);
  // Load token addresses from deployment.json (these are TestERC20 contracts for local testing)
  let tokens = loadTokensFromDeployments();

  // Fallback to TOKENS_FILE if provided
  if (process.env.TOKENS_FILE != null) {
    tokens = JSON.parse(readFileSync(process.env.TOKENS_FILE, 'utf8'));
    console.log(`Loaded tokens from TOKENS_FILE="${process.env.TOKENS_FILE}"`);
  }

  if (
    Object.keys(tokens).length === 0 ||
    Object.values(tokens).every((arr) => arr.length === 0)
  ) {
    console.error(
      '⚠️ No tokens found! Deploy contracts first with: yarn contracts:deploy'
    );
  }
  if (process.env.DEPLOYMENT) {
    const outTokensFile = `${process.env.DEPLOYMENT}/tokens.json`;
    console.log(`Writing token deployments to ${outTokensFile}`);
    writeFileSync(outTokensFile, JSON.stringify(tokens, null, 2));
  }
  const xlpAccount = privateKeyToAccount(providerPrivateKey);
  const providedXlpAddress = process.env.XLP_ADDRESS;
  const xlpLiquidityTarget = providedXlpAddress ?? xlpAccount.address;
  const l1WalletClient = createWalletClient({
    account: xlpAccount,
    transport: http(l1NetworkUrl),
    pollingInterval: 1000,
  });
  for (const url of networkUrls) {
    const walletClient = createWalletClient({
      account: xlpAccount,
      transport: http(url),
      pollingInterval: 1000,
    });
    const client = await createPublicClientFromUrl(url);
    const chainId = await client.getChainId();
    const masterAccount = await getMasterAccount(client);
    if (masterAccount !== walletClient.account?.address) {
      const bal = await client.getBalance({
        address: walletClient.account.address,
      });
      // Need enough for deposits (1 ETH per paymaster) + gas fees
      const requiredAmount = parseEther('5');
      if (bal < requiredAmount / 2n) {
        console.log(
          `💸 Funding XLP account ${walletClient.account.address} on chain ${chainId}...`
        );
        const fundingClient = client.extend(walletActions);
        const hash = await fundingClient.sendTransaction({
          account: masterAccount,
          to: walletClient.account.address,
          value: requiredAmount,
          chain: client.chain,
        });
        await client.waitForTransactionReceipt({ hash });
        console.log(`✅ Funded with 5 ETH (tx: ${hash})`);
      }
    }
    const sourcePaymaster = getDeployment(deploymentFile, chainId).paymaster;
    const liquidityTarget = xlpLiquidityTarget;
    if (providedXlpAddress != null) {
      await setEthBalance(providedXlpAddress, '777', url);
    }
    if ((process.env.NO_LIQUIDITY ?? '') === '') {
      await addTokensLiquidity(
        tokens,
        client,
        liquidityTarget,
        sourcePaymaster
      );
    }
    if ((process.env.NO_PROVIDERS ?? '') !== '') {
      console.log('NO_PROVIDERS is set, not starting mock servers.');
    } else {
      console.log('Starting mock provider for network:', url);
      await MockLiquidityProvider.create(walletClient, sourcePaymaster);
    }
    if ((process.env.NO_BRIDGES ?? '') !== '') {
      console.log('NO_BRIDGES is set, not starting mock bridges.');
    } else if (chainId === 1) {
      console.log('Skipping mock bridge process for L1 <-> L1.');
    } else {
      console.log('Starting mock bridge for network:', url);
      await MockBridge.create(l1WalletClient, walletClient);
    }
  }
}

// ==================== ENTRY POINT ====================

process.on('SIGTERM', () => {
  console.log('Stopping mock providers...');
  process.exit(0);
});

void startMockProviders();

export { startMockProviders };
