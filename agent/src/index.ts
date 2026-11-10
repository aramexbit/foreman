#!/usr/bin/env node
/**
 * Foreman agent CLI.
 *
 *   foreman run --task "..." --budget 2 [--auto-worker]
 *   foreman post --task "..." --budget 2
 *   foreman jobs [--from 0] [--limit 20]
 *   foreman job --id 1
 *   foreman receipt --id 1
 *   foreman quote --id 1 --price 0.4        (as the worker account)
 *   foreman work --id 1 --result "..."      (as the worker account)
 *   foreman verify --id 1 --pass | --fail   (as the foreman account)
 *   foreman counter --id 1 --price 0.4 --reasoning "..."
 *
 * Environment (see .env.example):
 *   CONTRACT_ID, FOREMAN_ACCOUNT_ID, FOREMAN_PRIVATE_KEY (or FOREMAN_KEY_FILE)
 *   WORKER_ACCOUNT_ID, WORKER_PRIVATE_KEY (or WORKER_KEY_FILE) — for --auto-worker
 *   NEAR_NETWORK (default testnet), NEAR_RPC_URL (optional)
 *   LLM_API_URL / LLM_API_KEY / LLM_MODEL — optional, for richer worker output
 */
import * as nearApi from "near-api-js";
import * as fs from "fs";
import * as path from "path";

// Load .env from the working directory if present (never committed; see .env.example).
for (const candidate of [path.join(process.cwd(), ".env"), path.join(__dirname, "..", "..", ".env")]) {
  if (fs.existsSync(candidate)) {
    for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)=(.*)\s*$/);
      if (m && !process.env[m[1]] && !m[2].startsWith("#")) process.env[m[1]] = m[2].trim();
    }
    break;
  }
}
import {
  loadConfig,
  connectAccount,
  callMethod,
  viewMethod,
  txLink,
  AgentConfig,
} from "./near";
import { breakdownTask, verifyWork, generateWork, llmGenerateWork, Subtask } from "./breakdown";

const { parseNearAmount } = nearApi.utils.format;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function argValue(argv: string[], name: string, fallback = ""): string {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

interface Job {
  id: string;
  poster: string;
  task: string;
  budget: string;
  budget_near: string;
  status: string;
  quote: { agent_id: string; price: string; price_near: string } | null;
  counter: { price: string; price_near: string; reasoning: string } | null;
  agreed_price: string | null;
  agreed_price_near: string | null;
  result: string | null;
  receipt: {
    job_id: string;
    task: string;
    bought: string;
    from: string;
    price: string;
    price_near: string;
    passed: boolean;
    refunded_to_poster: string;
    refunded_near: string;
  } | null;
  created_at: string;
}

async function getJob(account: nearApi.Account, contractId: string, id: string): Promise<Job> {
  const job = (await viewMethod(account, contractId, "get_job", { job_id: id })) as Job | null;
  if (!job) throw new Error(`Job ${id} does not exist`);
  return job;
}

async function waitForStatus(
  account: nearApi.Account,
  contractId: string,
  id: string,
  statuses: string[],
  timeoutMs = 120_000,
): Promise<Job> {
  const started = Date.now();
  for (;;) {
    const job = await getJob(account, contractId, id);
    if (statuses.includes(job.status)) return job;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for job ${id} to reach ${statuses.join("/")} (now ${job.status})`);
    }
    await sleep(3000);
  }
}

function printJob(job: Job): void {
  console.log(`\nJob #${job.id} [${job.status}]`);
  console.log(`  task:    ${job.task}`);
  console.log(`  poster:  ${job.poster}`);
  console.log(`  budget:  ${job.budget_near} NEAR (escrowed)`);
  if (job.quote) console.log(`  quote:   ${job.quote.price_near} NEAR by ${job.quote.agent_id}`);
  if (job.counter) {
    console.log(`  counter: ${job.counter.price_near} NEAR — "${job.counter.reasoning}"`);
  }
  if (job.agreed_price_near) console.log(`  agreed:  ${job.agreed_price_near} NEAR`);
  if (job.result) console.log(`  result:  ${job.result.slice(0, 200)}${job.result.length > 200 ? "…" : ""}`);
  if (job.receipt) printReceipt(job.receipt);
}

function printReceipt(r: Job["receipt"]): void {
  if (!r) return;
  console.log(`  ── receipt for job #${r.job_id} ──────────────────`);
  console.log(`  bought:   ${r.bought.slice(0, 160)}${r.bought.length > 160 ? "…" : ""}`);
  console.log(`  from:     ${r.from || "(nobody — no worker hired)"}`);
  console.log(`  price:    ${r.price_near} NEAR paid to worker`);
  console.log(`  passed:   ${r.passed ? "yes — work passed the check" : "no — work failed the check"}`);
  console.log(`  refunded: ${r.refunded_near} NEAR back to poster`);
}

async function cmdPost(cfg: AgentConfig, argv: string[]): Promise<void> {
  const task = argValue(argv, "--task");
  const budget = argValue(argv, "--budget");
  if (!task || !budget) throw new Error("Usage: foreman post --task \"...\" --budget 2");
  const account = await connectAccount(cfg, cfg.foremanAccountId, cfg.foremanPrivateKey);
  const deposit = parseNearAmount(budget);
  if (!deposit || BigInt(deposit) <= 0n) throw new Error(`Invalid budget: ${budget}`);
  const { txHash, result } = await callMethod(
    account, cfg.contractId, "post_job", { task, budget_near: budget }, BigInt(deposit),
  );
  console.log(`Job posted. tx: ${txLink(txHash)}`);
  printJob(result as Job);
}

async function cmdJobs(cfg: AgentConfig, argv: string[]): Promise<void> {
  const from = parseInt(argValue(argv, "--from", "0"), 10);
  const limit = parseInt(argValue(argv, "--limit", "20"), 10);
  const account = await connectAccount(cfg, cfg.foremanAccountId, cfg.foremanPrivateKey);
  const jobs = (await viewMethod(account, cfg.contractId, "list_jobs", {
    from_index: from, limit,
  })) as Job[];
  const count = (await viewMethod(account, cfg.contractId, "get_job_count", {})) as number;
  console.log(`\n${jobs.length} job(s) shown, ${count} total on ${cfg.contractId}`);
  for (const j of jobs) printJob(j);
}

async function cmdJob(cfg: AgentConfig, argv: string[]): Promise<void> {
  const id = argValue(argv, "--id");
  if (!id) throw new Error("Usage: foreman job --id 1");
  const account = await connectAccount(cfg, cfg.foremanAccountId, cfg.foremanPrivateKey);
  printJob(await getJob(account, cfg.contractId, id));
}

async function cmdReceipt(cfg: AgentConfig, argv: string[]): Promise<void> {
  const id = argValue(argv, "--id");
  if (!id) throw new Error("Usage: foreman receipt --id 1");
  const account = await connectAccount(cfg, cfg.foremanAccountId, cfg.foremanPrivateKey);
  const receipt = (await viewMethod(account, cfg.contractId, "get_receipt", { job_id: id })) as Job["receipt"];
  if (!receipt) {
    console.log(`Job ${id} has no receipt yet (it has not settled).`);
    return;
  }
  printReceipt(receipt);
}

async function cmdQuote(cfg: AgentConfig, argv: string[]): Promise<void> {
  const id = argValue(argv, "--id");
  const price = argValue(argv, "--price");
  if (!id || !price) throw new Error("Usage: foreman quote --id 1 --price 0.4");
  const who = cfg.workerAccountId && cfg.workerPrivateKey
    ? { id: cfg.workerAccountId, key: cfg.workerPrivateKey }
    : { id: cfg.foremanAccountId, key: cfg.foremanPrivateKey };
  const account = await connectAccount(cfg, who.id, who.key);
  const { txHash, result } = await callMethod(account, cfg.contractId, "quote", { job_id: id, price_near: price });
  console.log(`Quote of ${price} NEAR posted by ${who.id}. tx: ${txLink(txHash)}`);
  printJob(result as Job);
}

async function cmdWork(cfg: AgentConfig, argv: string[]): Promise<void> {
  const id = argValue(argv, "--id");
  const result = argValue(argv, "--result");
  if (!id || !result) throw new Error("Usage: foreman work --id 1 --result \"...\"");
  const who = cfg.workerAccountId && cfg.workerPrivateKey
    ? { id: cfg.workerAccountId, key: cfg.workerPrivateKey }
    : { id: cfg.foremanAccountId, key: cfg.foremanPrivateKey };
  const account = await connectAccount(cfg, who.id, who.key);
  const { txHash, result: job } = await callMethod(account, cfg.contractId, "submit_work", { job_id: id, result });
  console.log(`Work submitted by ${who.id}. tx: ${txLink(txHash)}`);
  printJob(job as Job);
}

async function cmdVerify(cfg: AgentConfig, argv: string[]): Promise<void> {
  const id = argValue(argv, "--id");
  const passed = hasFlag(argv, "--pass");
  const failed = hasFlag(argv, "--fail");
  if (!id || (!passed && !failed)) throw new Error("Usage: foreman verify --id 1 --pass | --fail");
  const account = await connectAccount(cfg, cfg.foremanAccountId, cfg.foremanPrivateKey);
  const { txHash, result } = await callMethod(account, cfg.contractId, "verify_and_pay", {
    job_id: id, passed,
  });
  console.log(`Work ${passed ? "PASSED" : "FAILED"} — settled on-chain. tx: ${txLink(txHash)}`);
  printJob(result as Job);
}

async function cmdCounter(cfg: AgentConfig, argv: string[]): Promise<void> {
  const id = argValue(argv, "--id");
  const price = argValue(argv, "--price");
  const reasoning = argValue(argv, "--reasoning");
  if (!id || !price || !reasoning) {
    throw new Error('Usage: foreman counter --id 1 --price 0.4 --reasoning "..."');
  }
  const account = await connectAccount(cfg, cfg.foremanAccountId, cfg.foremanPrivateKey);
  const { txHash, result } = await callMethod(account, cfg.contractId, "counter", {
    job_id: id, price_near: price, reasoning,
  });
  console.log(`Counter-offer of ${price} NEAR sent. tx: ${txLink(txHash)}`);
  printJob(result as Job);
}

/**
 * Full loop: break the task into subtasks, hire a worker for each, negotiate
 * once when a quote is above the plan, check the work, pay, and print receipts.
 */
async function cmdRun(cfg: AgentConfig, argv: string[]): Promise<void> {
  const task = argValue(argv, "--task");
  const budgetStr = argValue(argv, "--budget");
  const autoWorker = hasFlag(argv, "--auto-worker");
  if (!task || !budgetStr) {
    throw new Error('Usage: foreman run --task "..." --budget 2 [--auto-worker]');
  }
  const totalBudget = parseFloat(budgetStr);
  if (!(totalBudget > 0)) throw new Error(`Invalid budget: ${budgetStr}`);

  const foreman = await connectAccount(cfg, cfg.foremanAccountId, cfg.foremanPrivateKey);
  let worker: nearApi.Account | null = null;
  if (autoWorker) {
    if (!cfg.workerAccountId || !cfg.workerPrivateKey) {
      throw new Error("--auto-worker needs WORKER_ACCOUNT_ID and WORKER_PRIVATE_KEY");
    }
    worker = await connectAccount(cfg, cfg.workerAccountId, cfg.workerPrivateKey);
  }

  console.log(`\nForeman taking the task: "${task}"`);
  console.log(`Total budget: ${totalBudget} NEAR (escrowed per subtask, on ${cfg.contractId})`);
  const subs = breakdownTask(task, totalBudget);
  console.log(`Plan: ${subs.length} subtask(s), 20% of the budget kept as verification margin.`);
  subs.forEach((s, i) => {
    console.log(`  ${i + 1}. [${s.kind}] ${s.title} — planned spend ${s.plannedSpendNear} NEAR`);
  });

  const receipts: Array<NonNullable<Job["receipt"]>> = [];
  let totalSpent = 0;
  let totalRefunded = 0;

  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    console.log(`\n── Subtask ${i + 1}/${subs.length}: ${sub.title} ──`);

    // 1. Post the job, escrowing the planned spend.
    const deposit = parseNearAmount(sub.plannedSpendNear);
    const { txHash: postTx, result: posted } = await callMethod(
      foreman, cfg.contractId, "post_job",
      { task: `${sub.title}\n${sub.detail}`, budget_near: sub.plannedSpendNear },
      BigInt(deposit as string),
    );
    const job = posted as Job;
    console.log(`Posted job #${job.id} (${sub.plannedSpendNear} NEAR escrowed). tx: ${txLink(postTx)}`);

    // 2. Get a quote. In auto-worker mode the demo worker quotes; the first
    //    subtask is quoted ABOVE the plan on purpose, to show the counter.
    let quoted: Job;
    if (worker) {
      const markup = i === 0 ? 1.25 : 1.0; // first quote comes in 25% over plan
      const quotePrice = (parseFloat(sub.plannedSpendNear) * markup).toFixed(4);
      const { txHash } = await callMethod(worker, cfg.contractId, "quote", {
        job_id: job.id, price_near: quotePrice,
      });
      console.log(`Worker ${cfg.workerAccountId} quoted ${quotePrice} NEAR. tx: ${txLink(txHash)}`);
      quoted = await getJob(foreman, cfg.contractId, job.id);
    } else {
      console.log("Waiting for a worker to quote (polling, up to 10 min)...");
      quoted = await waitForStatus(foreman, cfg.contractId, job.id, ["quoted"], 600_000);
      console.log(`Worker ${quoted.quote!.agent_id} quoted ${quoted.quote!.price_near} NEAR.`);
    }

    // 3. Negotiate: if the quote is above the plan, counter ONCE at the plan.
    let agreed: Job;
    const quotePriceNear = parseFloat(quoted.quote!.price_near);
    if (quotePriceNear > parseFloat(sub.plannedSpendNear)) {
      const reasoning =
        `Your quote of ${quoted.quote!.price_near} NEAR is above my planned spend of ` +
        `${sub.plannedSpendNear} NEAR for this subtask (${sub.kind}). I can pay ` +
        `${sub.plannedSpendNear} NEAR — that keeps the whole task inside the ` +
        `${totalBudget} NEAR budget.`;
      const { txHash } = await callMethod(foreman, cfg.contractId, "counter", {
        job_id: job.id, price_near: sub.plannedSpendNear, reasoning,
      });
      console.log(`Countered once at ${sub.plannedSpendNear} NEAR: "${reasoning}" tx: ${txLink(txHash)}`);
      if (worker) {
        const { txHash: acceptTx } = await callMethod(worker, cfg.contractId, "accept_counter", { job_id: job.id });
        console.log(`Worker accepted the counter. tx: ${txLink(acceptTx)}`);
      } else {
        console.log("Waiting for the worker to accept the counter or walk away...");
        agreed = await waitForStatus(foreman, cfg.contractId, job.id, ["accepted", "open"], 600_000);
        if (agreed.status === "open") {
          console.log("Worker walked away. Foreman moves on without this subtask.");
          continue;
        }
      }
      agreed = await getJob(foreman, cfg.contractId, job.id);
    } else {
      const { txHash } = await callMethod(foreman, cfg.contractId, "accept_quote", { job_id: job.id });
      console.log(`Quote accepted at ${quoted.quote!.price_near} NEAR. tx: ${txLink(txHash)}`);
      agreed = await getJob(foreman, cfg.contractId, job.id);
    }

    // 4. Worker does the work and submits it.
    let workText: string;
    if (worker) {
      workText = (await llmGenerateWork(sub, task)) ?? generateWork(sub, task);
      const { txHash } = await callMethod(worker, cfg.contractId, "submit_work", {
        job_id: job.id, result: workText,
      });
      console.log(`Worker submitted work (${workText.length} chars). tx: ${txLink(txHash)}`);
    } else {
      console.log("Waiting for the worker to submit work (polling, up to 10 min)...");
      agreed = await waitForStatus(foreman, cfg.contractId, job.id, ["submitted"], 600_000);
      workText = agreed.result ?? "";
    }

    // 5. Foreman checks the work and settles on-chain.
    const check = verifyWork(sub, workText);
    console.log(`Check: ${check.passed ? "PASSED" : "FAILED"} — ${check.reasons.join("; ")}`);
    const { txHash: settleTx, result: settled } = await callMethod(
      foreman, cfg.contractId, "verify_and_pay", { job_id: job.id, passed: check.passed },
    );
    console.log(`Settled on-chain. tx: ${txLink(settleTx)}`);
    const settledJob = settled as Job;
    printJob(settledJob);
    if (settledJob.receipt) {
      receipts.push(settledJob.receipt);
      totalSpent += parseFloat(settledJob.receipt.price_near);
      totalRefunded += parseFloat(settledJob.receipt.refunded_near);
    }
  }

  // 6. Summary + save receipts.
  console.log(`\n════════ Foreman run complete ════════`);
  console.log(`Task:    ${task}`);
  console.log(`Budget:  ${totalBudget} NEAR`);
  console.log(`Spent:   ${totalSpent.toFixed(4)} NEAR paid to workers`);
  console.log(`Refund:  ${totalRefunded.toFixed(4)} NEAR back to poster (unspent escrow)`);
  console.log(`Within budget: ${totalSpent <= totalBudget ? "YES" : "NO — OVER BUDGET (bug!)"}`);
  const runDir = path.join(process.cwd(), "runs");
  fs.mkdirSync(runDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(runDir, `run-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    task, totalBudgetNear: totalBudget, totalSpentNear: totalSpent,
    totalRefundedNear: totalRefunded, receipts,
  }, null, 2));
  console.log(`Receipts saved to ${outFile}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log("Foreman — general-contractor agent on NEAR (testnet)\n");
    console.log("  foreman run --task \"...\" --budget 2 [--auto-worker]");
    console.log("  foreman post --task \"...\" --budget 2");
    console.log("  foreman jobs [--from 0] [--limit 20]");
    console.log("  foreman job --id 1");
    console.log("  foreman receipt --id 1");
    console.log("  foreman quote --id 1 --price 0.4");
    console.log("  foreman work --id 1 --result \"...\"");
    console.log("  foreman verify --id 1 --pass | --fail");
    console.log("  foreman counter --id 1 --price 0.4 --reasoning \"...\"");
    console.log("\nSee .env.example for the required environment variables.");
    return;
  }
  const cfg = loadConfig();
  switch (cmd) {
    case "run": await cmdRun(cfg, argv); break;
    case "post": await cmdPost(cfg, argv); break;
    case "jobs": await cmdJobs(cfg, argv); break;
    case "job": await cmdJob(cfg, argv); break;
    case "receipt": await cmdReceipt(cfg, argv); break;
    case "quote": await cmdQuote(cfg, argv); break;
    case "work": await cmdWork(cfg, argv); break;
    case "verify": await cmdVerify(cfg, argv); break;
    case "counter": await cmdCounter(cfg, argv); break;
    default:
      throw new Error(`Unknown command: ${cmd} (run "foreman --help")`);
  }
}

main().catch((e: unknown) => {
  console.error(`\nError: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
