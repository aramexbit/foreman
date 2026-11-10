/**
 * NEAR connection helpers for the Foreman agent.
 * Testnet only. Keys come from environment variables or key files — never
 * from the repository.
 */
import * as nearApi from "near-api-js";
import * as fs from "fs";

export const TESTNET_RPC = "https://rpc.testnet.near.org";
export const TESTNET_EXPLORER = "https://testnet.nearblocks.io";

export interface AgentConfig {
  networkId: string;
  nodeUrl: string;
  contractId: string;
  foremanAccountId: string;
  foremanPrivateKey: string;
  workerAccountId?: string;
  workerPrivateKey?: string;
}

function readKey(value: string | undefined, fileVar: string | undefined): string {
  if (value && value.trim().length > 0) return value.trim();
  if (fileVar && fs.existsSync(fileVar)) {
    const raw = JSON.parse(fs.readFileSync(fileVar, "utf8"));
    if (raw.private_key) return String(raw.private_key);
  }
  return "";
}

export function loadConfig(): AgentConfig {
  const contractId = process.env.CONTRACT_ID || "";
  if (!contractId) throw new Error("CONTRACT_ID is not set (see .env.example)");
  const foremanAccountId = process.env.FOREMAN_ACCOUNT_ID || "";
  const foremanPrivateKey = readKey(process.env.FOREMAN_PRIVATE_KEY, process.env.FOREMAN_KEY_FILE);
  if (!foremanAccountId || !foremanPrivateKey) {
    throw new Error("FOREMAN_ACCOUNT_ID and FOREMAN_PRIVATE_KEY (or FOREMAN_KEY_FILE) are required");
  }
  return {
    networkId: process.env.NEAR_NETWORK || "testnet",
    nodeUrl: process.env.NEAR_RPC_URL || TESTNET_RPC,
    contractId,
    foremanAccountId,
    foremanPrivateKey,
    workerAccountId: process.env.WORKER_ACCOUNT_ID || undefined,
    workerPrivateKey: readKey(process.env.WORKER_PRIVATE_KEY, process.env.WORKER_KEY_FILE) || undefined,
  };
}

export async function connectAccount(
  cfg: AgentConfig,
  accountId: string,
  privateKey: string,
): Promise<nearApi.Account> {
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  const keyPair = nearApi.utils.KeyPair.fromString(privateKey as never);
  await keyStore.setKey(cfg.networkId, accountId, keyPair);
  const near = await nearApi.connect({
    networkId: cfg.networkId,
    keyStore,
    nodeUrl: cfg.nodeUrl,
    walletUrl: "https://testnet.mynearwallet.com",
    helperUrl: "https://helper.testnet.near.org",
    explorerUrl: TESTNET_EXPLORER,
  } as never);
  return near.account(accountId);
}

export function txLink(txHash: string): string {
  return `${TESTNET_EXPLORER}/txns/${txHash}`;
}

/** Minimal structural type for the near-api-js Account methods we use. */
export interface AccountLike {
  functionCall(args: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
    gas: bigint;
    attachedDeposit: bigint;
  }): Promise<unknown>;
  viewFunction(args: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
  }): Promise<unknown>;
}

export function asAccountLike(account: nearApi.Account): AccountLike {
  return account as unknown as AccountLike;
}

/** Call a change method and return the transaction hash. */
export async function callMethod(
  account: nearApi.Account,
  contractId: string,
  method: string,
  args: Record<string, unknown>,
  depositYocto: bigint = 0n,
): Promise<{ txHash: string; result: unknown }> {
  const outcome = await asAccountLike(account).functionCall({
    contractId,
    methodName: method,
    args,
    gas: 100_000_000_000_000n,
    attachedDeposit: depositYocto,
  });
  const txHash: string = (outcome as { transaction: { hash: string } }).transaction.hash;
  // Decode the returned value (base64-encoded JSON) if present.
  let result: unknown = null;
  const status = (outcome as { status: unknown }).status as {
    SuccessValue?: string;
  };
  if (status && typeof status.SuccessValue === "string" && status.SuccessValue.length > 0) {
    try {
      result = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8"));
    } catch {
      result = Buffer.from(status.SuccessValue, "base64").toString("utf8");
    }
  }
  return { txHash, result };
}

/** Call a view method. */
export async function viewMethod(
  account: nearApi.Account,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return (asAccountLike(account).viewFunction({ contractId, methodName: method, args }));
}
