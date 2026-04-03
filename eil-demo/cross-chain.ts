import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  createPublicClient, createWalletClient, defineChain, http, 
  parseEther, formatUnits, getContract, keccak256, getCreate2Address, 
  type Address, type PublicClient, type Hex, encodeFunctionData 
} from 'viem';
import { privateKeyToAccount, toAccount, type LocalAccount } from 'viem/accounts';
import type { SmartAccount } from 'viem/account-abstraction';

// The big SDK imports
import { 
  CrossChainSdk, TransferAction, MultichainBundlerManager, BaseMultichainSmartAccount, 
  getUserOpHash, type UserOperation, type ChainInfo, type Call, asCall 
} from '@eil-protocol/sdk';
import DummyAccountArtifact from '@eil-protocol/contracts/artifacts/src/test/DummyAccount.sol/DummyAccount.json' with { type: 'json' };
import type { FunctionCall } from '@eil-protocol/sdk/src/types/Calls';

// ---------------------------------------------------------
// 🛠️  MOCK ACCOUNT SETUP (Skip to the good part below!)
// We just need these classes to pretend we have a real smart wallet 
// on both chains. Real apps would use Biconomy or Alchemy accounts.
// ---------------------------------------------------------

class InternalDummyAccount {
  constructor(readonly address: Address, readonly client: PublicClient, readonly entryPointAddress: Address, readonly entryPointVersion = '0.8') {}
  
  static async create(owner: LocalAccount, client: PublicClient, entryPointAddress: Address) {
    const createXAddress = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed' as Address;
    const baseSalt = keccak256(owner.address as Hex);
    const guardedSalt = keccak256(baseSalt);
    const initCode = DummyAccountArtifact.bytecode as Hex;
    const address = getCreate2Address({ from: createXAddress, salt: guardedSalt, bytecode: initCode });

    const code = await client.getCode({ address });
    if (!code || code === '0x') {
      const accounts = await client.request({ method: 'eth_accounts' }) as string[];
      const masterAcc = toAccount(accounts[0] as Address);
      const tempWallet = createWalletClient({ account: masterAcc, chain: client.chain, transport: http(client.transport.url!) });
      
      const createX = getContract({
        address: createXAddress,
        abi: [{ name: 'deployCreate2', type: 'function', inputs: [{ type: 'bytes32', name:"salt" }, { type: 'bytes', name:"initCode" }], outputs: [{ type: 'address' }], stateMutability: 'payable' }],
        client: { public: client, wallet: tempWallet } 
      });
      await client.waitForTransactionReceipt({ hash: await createX.write.deployCreate2([baseSalt, initCode]) });
    }
    return new InternalDummyAccount(address, client, entryPointAddress);
  }
  async getAddress() { return this.address; }
  async getNonce() { return 0n; }
  
  encodeCalls(calls: Call[]) {
    return encodeFunctionData({
      abi: [{ name: 'executeBatch', type: 'function', inputs: [{ type: 'tuple[]', name: "calls", components: [{ type: 'address', name: 'target' }, { type: 'uint256', name: 'value' }, { type: 'bytes', name: 'data' }] }] }],
      functionName: 'executeBatch',
      args: [calls.map(c => ({ target: c.to || '0x', value: c.value || 0n, data: c.data || '0x' })) as any],
    });
  }

  getFactoryArgs() {
    return { factory: '0x' as Address, factoryData: '0x' as Hex };
  }
}

class LocalMultiChainSmartAccount extends BaseMultichainSmartAccount {
  private localAccounts = new Map<bigint, InternalDummyAccount>();

  private constructor(readonly owner: LocalAccount, bundlerManager: MultichainBundlerManager) { super(bundlerManager); }

  static async create(owner: LocalAccount, sdk: CrossChainSdk, chains: bigint[], infos: ChainInfo[], entryPoint: Address) {
    const netEnv = sdk.getNetworkEnv();
    const account = new LocalMultiChainSmartAccount(owner, new MultichainBundlerManager(netEnv.input.chainInfos));
    for (const c of chains) {
      const info = infos.find(i => i.chainId === c);
      if (info) account.localAccounts.set(c, await InternalDummyAccount.create(owner, info.publicClient, entryPoint));
    }
    return account;
  }

  hasAddress(chainId: bigint) { return this.localAccounts.has(chainId); }
  contractOn(chainId: bigint) { return this.localAccounts.get(chainId) as unknown as SmartAccount; }

  async signUserOps(userOps: UserOperation[]) {
    return Promise.all(userOps.map(async (op) => {
      const hash = getUserOpHash(op); 
      const sig = await this.owner.signMessage({ message: { raw: hash as `0x${string}` } });
      return { ...op, signature: sig };
    }));
  }

  async encodeCalls(chainId: bigint, calls: Array<Call | FunctionCall>) {
    const plainCalls: Call[] = calls.map(c => asCall(chainId, c));
    return this.localAccounts.get(chainId)!.encodeCalls(plainCalls) as Hex;
  }
}


// ---------------------------------------------------------
// Cross-Chain Bridge Execution Script
// ---------------------------------------------------------

async function runMyAwesomeBridge() {
  console.log("Starting cross-chain USDC transfer...");

  // -------------------------------------------------------------------------
  // Step 1: Load Deployment Configurations
  // -------------------------------------------------------------------------
  // Grab the deployed contracts JSON
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const deploymentFile = path.resolve(__dirname, 'deployment.json');
  const dData = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));

  const arbConfig = dData.find((d: any) => d.chainId === 42161);
  const opConfig = dData.find((d: any) => d.chainId === 10);

  // Setup networks
  const chainArb = defineChain({ 
    id: 42161, 
    name: 'Local Arbitrum', 
    nativeCurrency: { 
        name: 'ETH', 
        symbol: 'ETH', 
        decimals: 18
    }, 
    rpcUrls: { 
        default: { 
            http: ['http://localhost:8501'] 
        } 
    } 
  });
  
  const chainOp = defineChain({ 
    id: 10, 
    name: 'Local Optimism', 
    nativeCurrency: { 
        name: 'ETH', 
        symbol: 'ETH', 
        decimals: 18 
    }, 
    rpcUrls: { 
        default: { 
            http: ['http://localhost:8503'] 
        } 
    } 
 });

  const arbPublic = createPublicClient({ chain: chainArb, transport: http('http://localhost:8501') });
  const opPublic = createPublicClient({ chain: chainOp, transport: http('http://localhost:8503') });

  // -------------------------------------------------------------------------
  // Step 2: Initialize EIL SDK
  // -------------------------------------------------------------------------
  const chainInfos: any[] = [
    { chainId: BigInt(chainArb.id), publicClient: arbPublic, bundlerUrl: arbConfig.bundlerUrl, paymasterAddress: arbConfig.paymaster as Address, entryPointAddress: arbConfig.entryPoint as Address, l1ChainId: 31337n, endpointUrl: 'http://localhost:8501', isL1: false, contracts: arbConfig },
    { chainId: BigInt(chainOp.id), publicClient: opPublic, bundlerUrl: opConfig.bundlerUrl, paymasterAddress: opConfig.paymaster as Address, entryPointAddress: opConfig.entryPoint as Address, l1ChainId: 31337n, endpointUrl: 'http://localhost:8503', isL1: false, contracts: opConfig }
  ];

  console.log("Setting up the EIL SDK...");
  const eilDemoSdk = new CrossChainSdk({
    chainInfos,
    expireTimeSeconds: 3600,
    execTimeoutSeconds: 600
  });

  // Make sure SDK knows about our test token
  eilDemoSdk.createToken('USDC', [
    { chainId: 42161, address: arbConfig.tokens.USDC },
    { chainId: 10, address: opConfig.tokens.USDC }
  ]);

  // -------------------------------------------------------------------------
  // Step 3: Setup Local Smart Account
  // -------------------------------------------------------------------------
  // Random EOA for signing stuff
  const eoaOwner = privateKeyToAccount('0xb0fc571181b03bbb5a7e52d4441956339607ff53ba1f019101b4445ff6fd91cd' as Hex);
  
  const mySmartWallet = await LocalMultiChainSmartAccount.create(
    eoaOwner, eilDemoSdk, [BigInt(chainArb.id), BigInt(chainOp.id)], chainInfos, arbConfig.entryPoint as Address
  );
  
  const walletAddress = mySmartWallet.addressOn(BigInt(chainArb.id));
  console.log(`   Smart wallet address: ${walletAddress}`);

  // -------------------------------------------------------------------------
  // Step 4: Fund the Smart Wallet
  // -------------------------------------------------------------------------
  // Fetch the local node miner so we actually have gas
  const arbMinerActs = await arbPublic.request({ method: 'eth_accounts' }) as string[];
  const masterFunder = toAccount(arbMinerActs[0] as Address);
  const funderClientArb = createWalletClient({ account: masterFunder, chain: chainArb, transport: http('http://localhost:8501') });
  
  const opMinerActs = await opPublic.request({ method: 'eth_accounts' }) as string[];
  const opMiner = toAccount(opMinerActs[0] as Address);
  const funderClientOp = createWalletClient({ account: opMiner, chain: chainOp, transport: http('http://localhost:8503') });

  console.log("Funding wallet with gas (ETH) and USDC...");
  
  // Give it gas
  await funderClientArb.sendTransaction({ to: walletAddress, value: parseEther('1') });
  await funderClientOp.sendTransaction({ to: walletAddress, value: parseEther('1') });

  // Mint USDC on source chain (Arbitrum)
  const usdcAddressArb = arbConfig.tokens.USDC as Address;
  const usdcAddressOp = opConfig.tokens.USDC as Address;
  
  const usdcArb = getContract({ address: usdcAddressArb, abi: [{ name: 'sudoMint', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }, { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }], client: { public: arbPublic, wallet: funderClientArb } });
  const usdcOp = getContract({ address: usdcAddressOp, abi: [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }], client: { public: opPublic } });
  
  await usdcArb.write.sudoMint([walletAddress, 10_000_000_000n]); 

  const balBefore = await usdcArb.read.balanceOf([walletAddress]);
  const balBeforeOp = await usdcOp.read.balanceOf([walletAddress]);
  console.log(`   Balance on Arbitrum: ${formatUnits(balBefore, 6)} USDC`);
  console.log(`   Balance on Optimism: ${formatUnits(balBeforeOp, 6)} USDC`);


  // -------------------------------------------------------------------------
  // Step 5: Build Cross-Chain Sequence (Batches)
  // -------------------------------------------------------------------------
  console.log('Building the cross-chain sequence...');
  const builder = eilDemoSdk.createBuilder();
  builder.useAccount(mySmartWallet);
  const amtToBridge = 300000n; // 300 USDC (6 decimals)

  const USDC = eilDemoSdk.createToken('USDC', [{ chainId: 42161, address: arbConfig.tokens.USDC }, { chainId: 10, address: opConfig.tokens.USDC }]);

  // referencing eil sdk
  builder.startBatch(BigInt(chainArb.id))
         .addAction(new TransferAction({ token: USDC, recipient: walletAddress, amount: amtToBridge, destChainId: BigInt(chainOp.id), voucherId: 'baba-voucher' }))
         .addVoucherRequest({
           tokens: [{ token: USDC, amount: amtToBridge }],
           destinationChainId: BigInt(chainOp.id),
           ref: 'baba-voucher'
         })
         .endBatch();

  builder.startBatch(BigInt(chainOp.id))
         .useVoucher('baba-voucher')
         .addAction(new TransferAction({ token: USDC, recipient: walletAddress, amount: amtToBridge }))
         .endBatch();

  // -------------------------------------------------------------------------
  // Step 6: Sign & Execute
  // -------------------------------------------------------------------------
  console.log('Signing the transactions...');
  const executor = await builder.buildAndSign();

  console.log('Executing cross-chain batches...');
  await executor.execute(({ index, type, txHash }) => {
    const txInfo = txHash ? ` (tx: ${txHash.slice(0, 18)}...)` : '';
    console.log(`   Batch ${index}: ${type}${txInfo}`);
  });

  // -------------------------------------------------------------------------
  // Step 7: Verify Balances
  // -------------------------------------------------------------------------
  console.log('Operation completed! Checking final balances...');
  const balAfter = await usdcArb.read.balanceOf([walletAddress]);
  const balAfterOp = await usdcOp.read.balanceOf([walletAddress]);
  console.log('   Final Balance on Arbitrum: ' + formatUnits(balAfter, 6) + ' USDC');
  console.log('   Final Balance on Optimism: ' + formatUnits(balAfterOp, 6) + ' USDC');
}

runMyAwesomeBridge().catch(console.error);
