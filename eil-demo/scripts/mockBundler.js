/**
 * Mock bundler CLI script for EIL Protocol.
 *
 * This file runs a mock bundler for EIL SDK account abstraction testing.
 *
 * - Uses @eil-protocol/contracts artifacts via contractArtifacts.js
 * - Compatible with EIL SDK's expected EntryPoint
 */

// ==================== IMPORTS ====================
import { createServer } from 'node:http';
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
  custom,
  parseEther,
  getContract,
  keccak256,
  toHex,
  checksumAddress,
  walletActions,
  stringToHex,
  hexToBigInt,
  decodeFunctionData,
  decodeErrorResult,
  parseEventLogs,
  getAddress,
  size,
  sliceHex,
} from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import {
  toPackedUserOperation,
  getUserOperationHash,
} from 'viem/account-abstraction';

// Import contract artifacts from EIL artifacts file
import {
  CrossChainPaymaster_default,
  ICrossChainPaymaster_default,
  L1AtomicSwapStakeManager_default,
  SimplePaymaster_default,
  RuntimeVarsHelper_default,
  CreateX_default,
  AtomicSwapTypes_default,
  TestERC20_default,
  SimpleAccountFactory_default,
  EntryPoint_default,
} from './contractArtifacts.js';

// ==================== ALL METADATA FOR ERROR DECODING ====================
// Note: Using SimpleAccountFactory_default instead of CrossLayerAccountFactory_default
const allMetaData = [
  EntryPoint_default,
  SimpleAccountFactory_default,
  ICrossChainPaymaster_default,
  L1AtomicSwapStakeManager_default,
  CrossChainPaymaster_default,
  CreateX_default,
  RuntimeVarsHelper_default,
  SimplePaymaster_default,
  AtomicSwapTypes_default,
  TestERC20_default,
];

// ==================== UTILITY FUNCTIONS ====================

async function getMasterAccount(client, index = 0) {
  const accounts = await client.request({ method: 'eth_accounts' });
  if (accounts == null || accounts.length === 0) {
    throw new Error(`Node doesn't support "eth_accounts"`);
  }
  return checksumAddress(accounts[index]);
}

async function fund(publicClient, target, amount = parseEther('1.0')) {
  if ((await publicClient.getBalance({ address: target })) < amount / 2n) {
    await publicClient.extend(walletActions).sendTransaction({
      account: await getMasterAccount(publicClient),
      chain: null,
      to: target,
      value: amount,
    });
  }
}

// ==================== CONTRACT WRAPPERS ====================

function getEntryPoint(client, address) {
  return getContract({
    abi: EntryPoint_default.abi,
    address,
    client,
  });
}

// ==================== ERROR DECODING ====================

let globalAbi = [];

function getGlobalAbi() {
  try {
    if (globalAbi.length === 0) {
      initDecodeErrorAbis(allMetaData);
    }
  } catch (e) {
    console.log('=== Error reading global ABI ===', e);
  }
  return globalAbi;
}

function initDecodeErrorAbis(artifacts) {
  const uniqueErrors = new Map();
  for (const artifact of artifacts) {
    if (!artifact.abi) {
      console.warn(`Artifact ${artifact.name} has no ABI, skipping`);
      continue;
    }
    artifact.abi.forEach((item) => {
      if (item.type === 'error') {
        uniqueErrors.set(item.name, item);
      }
    });
    globalAbi = Array.from(uniqueErrors.values());
  }
}

function decodeErrorArgs(decoded) {
  const args = decoded.args ?? [];
  args.forEach((arg, index) => {
    if (typeof arg === 'string' && arg.startsWith('0x')) {
      args[index] = recursiveDecodeErrorResult(arg);
    }
  });
  return (
    decoded.errorName +
    '(' +
    args
      .map((a) =>
        typeof a === 'string'
          ? `"${a}"`
          : typeof a === 'bigint'
          ? a.toString()
          : a
      )
      .join(', ') +
    ')'
  );
}

function recursiveDecodeErrorResult(bytes) {
  try {
    return decodeErrorArgs(
      decodeErrorResult({ abi: getGlobalAbi(), data: bytes })
    );
  } catch {
    return bytes;
  }
}

// ==================== USER OPERATION UTILS ====================

const PAYMASTER_SIG_MAGIC = '0x22e325a297439656';
const PAYMASTER_SIG_MAGIC_LEN = 8;
const PAYMASTER_SIGNATURE_TRAILER_LEN = PAYMASTER_SIG_MAGIC_LEN + 2;

function getUserOpHash(op) {
  return getUserOperationHash({
    userOperation: withSanitizedPaymasterData(op),
    entryPointAddress: op.entryPointAddress,
    entryPointVersion: '0.8',
    chainId: Number(op.chainId),
  });
}

function getPaymasterDataForSigning(paymasterData) {
  if (
    paymasterData.slice(0, PAYMASTER_SIG_MAGIC_LEN * 2 + 2) ===
    PAYMASTER_SIG_MAGIC
  ) {
    return paymasterData.slice(
      0,
      paymasterData.length - PAYMASTER_SIGNATURE_TRAILER_LEN * 2
    );
  }
  return paymasterData;
}

function withSanitizedPaymasterData(op) {
  return {
    ...op,
    paymasterData: getPaymasterDataForSigning(op.paymasterData ?? '0x'),
  };
}

// ==================== JSON-RPC SERVER ====================

class JsonRpcError extends Error {
  constructor(message, code, data) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = 'RpcError';
  }
}

class JsonRpcServer {
  constructor(options) {
    this.options = options;
    this.port = options.port || 3000;
    this.server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
      );
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      this._handleRequest(req, res);
    });
  }
  server;
  port;

  async handleRpcRequest(method, _params) {
    throw new JsonRpcError(`Method not found: ${method}`, -32601);
  }

  getRpcUrl() {
    return `http://localhost:${this.port}`;
  }

  async start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.onStarted();
        resolve();
      });
    });
  }

  onStarted() {
    console.log(`JSON-RPC server listening on port ${this.port}`);
  }

  onStopped() {
    console.log(`JSON-RPC server stopped on port ${this.port}`);
  }

  async stop() {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.onStopped();
          resolve();
        }
      });
    });
  }

  debug(...args) {
    if (this.options.log) {
      console.log(...args);
    }
  }

  async handleJson(payload) {
    const { method, params, id, jsonrpc } = payload;
    this.debug('>>', payload);
    let ret;
    try {
      const result = await this.handleRpcRequest(method, params);
      ret = { jsonrpc, id, result };
    } catch (error) {
      ret = {
        jsonrpc,
        id,
        error: {
          code: error.code ?? -32000,
          message: error.message,
          data: error.data ?? null,
        },
      };
    }
    this.debug('<<', ret);
    return ret;
  }

  _handleRequest(req, res) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      const payload = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let resp;
      if (!Array.isArray(payload)) {
        resp = await this.handleJson(payload);
      } else {
        const resps = [];
        for (const item of payload) {
          resps.push(await this.handleJson(item));
        }
        resp = resps;
      }
      res.end(
        JSON.stringify(resp, (k, v) => {
          if (typeof v === 'bigint') {
            return toHex(v);
          }
          return v;
        })
      );
    });
  }
}

// ==================== MOCK BUNDLER ====================

function unpackGasLimits(gasLimits) {
  const val = hexToBigInt(gasLimits);
  return [val >> 128n, val & ((1n << 128n) - 1n)];
}

function toUnpackedUserOperation(packed) {
  const [verificationGasLimit, callGasLimit] = unpackGasLimits(
    packed.accountGasLimits
  );
  const [maxPriorityFeePerGas, maxFeePerGas] = unpackGasLimits(packed.gasFees);
  let deployerInfo = {};
  let paymasterInfo = {};
  if (packed.paymasterAndData !== '0x') {
    const paymaster = getAddress(packed.paymasterAndData.slice(0, 42));
    const [paymasterVerificationGasLimit, paymasterPostOpGasLimit] =
      unpackGasLimits(packed.paymasterAndData.slice(42, 74));
    paymasterInfo = {
      paymaster,
      paymasterVerificationGasLimit,
      paymasterPostOpGasLimit,
      paymasterData: packed.paymasterAndData.slice(74),
    };
  }
  let factoryInfo = {};
  if (packed.initCode !== '0x') {
    const factory = packed.initCode.slice(0, 42);
    let factoryData = undefined;
    if (size(packed.initCode) > 20) {
      factoryData = sliceHex(packed.initCode, 20);
    }
    factoryInfo = {
      factory,
      factoryData,
    };
  }
  return {
    sender: getAddress(packed.sender),
    nonce: packed.nonce,
    ...factoryInfo,
    callData: packed.callData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas: packed.preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: packed.signature,
    ...deployerInfo,
    ...paymasterInfo,
  };
}

class MockBundler extends JsonRpcServer {
  constructor(options, chain, client, account, wallet, entryPoint) {
    super({
      port: options.port,
      log: options.log,
    });
    this.options = options;
    this.chain = chain;
    this.client = client;
    this.account = account;
    this.wallet = wallet;
    this.entryPoint = entryPoint;
    this.nodeTransport = custom({
      request: this.options.nodeRpcClient,
    });
  }
  chain;
  wallet;
  client;
  account;
  nodeTransport;
  userOpHashToTxHash = {};
  entryPoint;

  onStarted() {
    this.client.getChainId().then((chainId) => {
      console.log(
        `Mock bundler listening on chain ${chainId}, port ${this.options.port}`
      );
    });
  }

  onStopped() {
    console.log(`Mock bundler stopped on port ${this.options.port}`);
  }

  static async create(options) {
    const client = createPublicClient({
      transport: custom({
        request: async (args) => {
          return options.nodeRpcClient({
            method: args.method,
            params: args.params,
          });
        },
      }),
    });
    const chainId = await client.getChainId();
    const chain = { ...anvil, id: chainId, name: `chain-${chainId}` };
    const signer = options.signer;
    let account;
    let shouldFund = false;
    if (signer?.privateKey != null) {
      const pk = signer.privateKey.startsWith('0x')
        ? signer.privateKey
        : `0x${signer.privateKey}`;
      account = privateKeyToAccount(pk);
    } else if (signer?.mnemonic != null) {
      account = mnemonicToAccount(signer.mnemonic, {
        accountIndex: signer.mnemonicAccountIndex ?? 0,
      });
    } else {
      const privKey = keccak256(stringToHex('a-mock-bundler'));
      account = privateKeyToAccount(privKey);
      shouldFund = true;
    }
    if (shouldFund) {
      await fund(client, account.address, parseEther('1'));
    }
    const wallet = createWalletClient({
      chain,
      account,
      transport: custom({
        request: async (args) => {
          return options.nodeRpcClient({
            method: args.method,
            params: args.params,
          });
        },
      }),
    });
    const entryPoint = getEntryPoint(wallet, options.entryPointAddress);
    return new MockBundler(
      options,
      chain,
      client,
      account.address,
      wallet,
      entryPoint
    );
  }

  handleRpcRequest(method, params) {
    switch (method) {
      case 'eth_sendUserOperation':
        return this.sendUserOperation(method, params);
      case 'eth_supportedEntryPoints':
        return Promise.resolve([this.options.entryPointAddress]);
      case 'eth_getUserOperationReceipt':
        return this.getUserOperationReceipt(method, params);
      case 'eth_getUserOperation':
        return this.getUserOperation(method, params);
      default:
        return this.passThroughHandler(method, params);
    }
  }

  async sendUserOperation(_method, params) {
    const userOp = params[0];
    const packed = toPackedUserOperation(userOp);
    const userOpHash = getUserOpHash({
      ...userOp,
      signature: '0x',
      entryPointAddress: this.entryPoint.address,
      chainId: BigInt(this.chain.id),
    });

    // ===== VERBOSE LOGGING: UserOp received =====
    const hasFactory = userOp.factory && userOp.factory !== '0x';
    const hasPaymaster = userOp.paymaster && userOp.paymaster !== '0x';
    const callDataSize = userOp.callData ? (userOp.callData.length - 2) / 2 : 0;

    console.log(
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
    console.log(`📥 UserOp RECEIVED on chain ${this.chain.id}`);
    console.log(`   Sender: ${userOp.sender}`);
    console.log(`   Nonce: ${userOp.nonce}`);
    console.log(`   CallData size: ${callDataSize} bytes`);
    if (hasFactory) {
      console.log(`   Factory: ${userOp.factory} (account deployment)`);
    }
    if (hasPaymaster) {
      console.log(`   Paymaster: ${userOp.paymaster}`);
    }
    console.log(`   UserOpHash: ${userOpHash}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    try {
      const GAS_LIMIT = '0x1000000';
      console.log(`🔄 Submitting to EntryPoint.handleOps...`);

      const txHash = await this.entryPoint.write.handleOps(
        [[packed], this.wallet.account?.address],
        {
          account: this.wallet.account,
          chain: this.wallet.chain,
          gas: GAS_LIMIT,
        }
      );
      this.userOpHashToTxHash[userOpHash] = txHash;

      // ===== VERBOSE LOGGING: UserOp success =====
      console.log(`✅ UserOp SUCCESS on chain ${this.chain.id}`);
      console.log(`   UserOpHash: ${userOpHash}`);
      console.log(`   TxHash: ${txHash}`);
      console.log(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
      );
    } catch (e) {
      // ===== VERBOSE LOGGING: UserOp failure =====
      console.error(`❌ UserOp FAILED on chain ${this.chain.id}`);
      console.error(`   UserOpHash: ${userOpHash}`);
      console.error(`   Sender: ${userOp.sender}`);

      const raw = (e?.cause?.details ?? e?.message ?? '').toString();
      let msg = this.decodeErrorMessage(raw);

      console.error(`   Error: ${msg}`);
      if (e?.cause?.shortMessage) {
        console.error(`   Short: ${e.cause.shortMessage}`);
      }
      console.error(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
      );

      throw new JsonRpcError(msg, 32000);
    }
    return userOpHash;
  }

  async getUserOperation(_method, params) {
    const userOpHash = params[0];
    const txHash = this.userOpHashToTxHash[userOpHash];
    const tx = await this.client.getTransaction({ hash: txHash });
    const decoded = decodeFunctionData({
      abi: this.entryPoint.abi,
      data: tx.input,
    });
    if (decoded.functionName !== 'handleOps') {
      throw new JsonRpcError('getUserOperation decode failure', -32000);
    }
    const packedUserOps = decoded.args[0];
    if (packedUserOps.length !== 1) {
      throw new JsonRpcError(
        `expected one userop in bundle. found: ${packedUserOps.length}`,
        -32000
      );
    }
    return toUnpackedUserOperation(packedUserOps[0]);
  }

  async getUserOperationReceipt(_method, params) {
    const userOpHash = params[0];
    const abi = this.entryPoint.abi;
    const txHash = await this.getTxHashForUserOperationHash(userOpHash);
    const receipt = await this.client.getTransactionReceipt({ hash: txHash });
    const logs = receipt.logs;
    const parsedEvents = parseEventLogs({
      abi,
      logs,
      eventName: 'UserOperationEvent',
    });
    const userOpEvent = parsedEvents.find(
      (e) => e.args.userOpHash === userOpHash
    );
    if (userOpEvent == null) {
      throw new Error('No UserOperationEvent found in the logs');
    }
    let reason = '';
    if (userOpEvent.args.success === false) {
      const error = parseEventLogs({
        abi,
        logs,
        eventName: 'UserOperationRevertReason',
      }).find((e) => e.args.userOpHash === userOpHash);
      if (error?.length > 0) {
        reason = error.args.revertReason;
      }
    }
    return {
      receipt,
      logs: this.filterUserOpLogs(userOpHash, logs),
      success: userOpEvent.args.success,
      actualGasCost: userOpEvent.args.actualGasCost,
      actualGasUsed: userOpEvent.args.actualGasUsed,
      nonce: userOpEvent.args.nonce,
      paymaster: userOpEvent.args.paymaster,
      reason,
      sender: userOpEvent.args.sender,
      userOpHash,
    };
  }

  filterUserOpLogs(userOpHash, logs) {
    return logs;
  }

  decodeErrorMessage(msg) {
    const matchResponse = msg.match(/return data: (0x\w+)/);
    if (matchResponse) {
      const bytes = matchResponse[1];
      return recursiveDecodeErrorResult(bytes);
    }
    const failedOp = msg.match(/FailedOp\([^)]*\)/);
    if (failedOp) {
      return failedOp[0];
    }
    return msg;
  }

  async passThroughHandler(method, params) {
    return await this.options.nodeRpcClient({ method, params });
  }

  async getTxHashForUserOperationHash(userOpHash) {
    if (this.userOpHashToTxHash[userOpHash] != null) {
      return this.userOpHashToTxHash[userOpHash];
    }
    throw Error('');
  }
}

// ==================== ENTRY POINT ====================

import { existsSync, readFileSync } from 'node:fs';

// Helper to get entrypoint from deployment file if not set in env
function getEntrypointAddress() {
  if (process.env.ENTRYPOINT) {
    return process.env.ENTRYPOINT;
  }

  // Try to read from deployment file
  const deploymentFile = process.env.DEPLOYMENT_FILE
    ? resolve(__dirname, process.env.DEPLOYMENT_FILE)
    : resolve(__dirname, 'deployment.json');

  if (existsSync(deploymentFile)) {
    try {
      const deployments = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
      // Handle both array and object formats
      const chainDataList = Array.isArray(deployments)
        ? deployments
        : Object.values(deployments);

      // Get entrypoint from any chain (they should all be the same)
      for (const chainData of chainDataList) {
        if (chainData.entryPoint) {
          console.log(
            `Using entrypoint from deployment file: ${chainData.entryPoint}`
          );
          return chainData.entryPoint;
        }
      }
    } catch (e) {
      console.warn(`Warning: Could not read deployment file: ${e.message}`);
    }
  }

  throw new Error(
    'ENTRYPOINT environment variable is not set and could not be read from deployment file'
  );
}

if (process.env.NODE_URL == null) {
  throw new Error('NODE_URL environment variable is not set');
}

const entrypointAddress = getEntrypointAddress();

const publicClient = createPublicClient({
  transport: http(process.env.NODE_URL),
});

const signerConfig = (() => {
  if (
    process.env.BUNDLER_PRIVATE_KEY != null &&
    process.env.BUNDLER_PRIVATE_KEY.trim().length > 0
  ) {
    return { privateKey: process.env.BUNDLER_PRIVATE_KEY.trim() };
  }
  if (
    process.env.BUNDLER_MNEMONIC != null &&
    process.env.BUNDLER_MNEMONIC.trim().length > 0
  ) {
    const idx =
      process.env.BUNDLER_MNEMONIC_INDEX != null
        ? Number(process.env.BUNDLER_MNEMONIC_INDEX)
        : 0;
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error('BUNDLER_MNEMONIC_INDEX must be a non-negative integer');
    }
    return {
      mnemonic: process.env.BUNDLER_MNEMONIC.trim(),
      mnemonicAccountIndex: idx,
    };
  }
  return undefined;
})();

process.on('SIGTERM', () => {
  console.log('Stopping mock bundler...');
  process.exit(0);
});

void (async () => {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const bundler = await MockBundler.create({
    entryPointAddress: entrypointAddress,
    port,
    log: process.env.DEBUG != null,
    nodeRpcClient: (args) => publicClient.request(args),
    signer: signerConfig,
  });
  console.log('Starting bundler, address:', bundler.account);
  await bundler.start();
})();

export { MockBundler };
