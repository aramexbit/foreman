/**
 * Foreman dashboard (frontend/src/app.js, bundled with esbuild to bundle.js).
 * Plain JS + near-api-js. Talks to the Foreman contract on NEAR testnet.
 * Read-only browsing works without a key; posting/verifying needs a testnet
 * private key, which stays in this browser's localStorage.
 */
import * as nearApi from "near-api-js";

const RPC_URL = "https://rpc.testnet.near.org";
const EXPLORER = "https://testnet.nearblocks.io";
// Filled in after deployment (see README.md). Editable in the UI.
const DEFAULT_CONTRACT_ID = "foreman-ct-261110a.testnet";

const $ = (id) => document.getElementById(id);

let near = null;
let account = null;      // near-api-js Account (may be keyless in read-only mode)
let accountId = "";
let contractId = "";
let autoTimer = null;

function status(el, msg, kind = "") {
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function connect(readOnly) {
  contractId = $("contractId").value.trim();
  accountId = $("accountId").value.trim();
  if (!contractId) return status($("connStatus"), "Enter the contract account first.", "error");
  if (!readOnly && !accountId) return status($("connStatus"), "Enter your testnet account (or use read-only).", "error");

  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  if (!readOnly) {
    const pk = $("privateKey").value.trim();
    if (!pk) return status($("connStatus"), "Paste your testnet private key (or use read-only).", "error");
    try {
      await keyStore.setKey("testnet", accountId, nearApi.utils.KeyPair.fromString(pk));
    } catch {
      return status($("connStatus"), "That private key does not parse (expected ed25519:...).", "error");
    }
    localStorage.setItem("foreman:key", pk);
  }
  localStorage.setItem("foreman:contract", contractId);
  localStorage.setItem("foreman:account", accountId);

  near = await nearApi.connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: RPC_URL,
    walletUrl: "https://testnet.mynearwallet.com",
    helperUrl: "https://helper.testnet.near.org",
    explorerUrl: EXPLORER,
  });
  // In read-only mode there is no signer; use the contract account as the
  // view caller (view calls do not need a key).
  account = await near.account(readOnly ? contractId : accountId);
  $("contractEcho").textContent = contractId;
  $("postBtn").disabled = readOnly;
  status($("connStatus"), readOnly ? `Read-only view of ${contractId}.` : `Connected as ${accountId}.`, "ok");
  await refreshAll();
  startAutoRefresh();
}

async function view(method, args = {}) {
  return account.viewFunction({ contractId, methodName: method, args });
}

async function call(method, args, depositYocto = 0n) {
  const outcome = await account.functionCall({
    contractId,
    methodName: method,
    args,
    gas: 100_000_000_000_000n,
    attachedDeposit: depositYocto,
  });
  return outcome.transaction.hash;
}

function pill(statusText) {
  return `<span class="pill ${esc(statusText)}">${esc(statusText)}</span>`;
}

function renderJobs(jobs) {
  const box = $("jobsList");
  if (!jobs.length) {
    box.innerHTML = `<p class="hint">No jobs yet. Post one above.</p>`;
    return;
  }
  box.innerHTML = jobs.map((j) => {
    const actions = [];
    if (accountId && j.poster === accountId) {
      if (j.status === "quoted") {
        actions.push(`<button class="small" data-act="accept_quote" data-id="${j.id}">Accept quote (${esc(j.quote.price_near)} NEAR)</button>`);
        actions.push(`<button class="small" data-act="counter" data-id="${j.id}">Counter once…</button>`);
        actions.push(`<button class="small" data-act="reject_quote" data-id="${j.id}">Walk away</button>`);
      }
      if (j.status === "submitted") {
        actions.push(`<button class="small" data-act="verify_pass" data-id="${j.id}">Verify: pass &amp; pay</button>`);
        actions.push(`<button class="small" data-act="verify_fail" data-id="${j.id}">Verify: fail &amp; refund</button>`);
      }
      if (j.status === "open") {
        actions.push(`<button class="small" data-act="cancel" data-id="${j.id}">Cancel &amp; refund</button>`);
      }
    }
    return `<div class="job">
      <h3>Job #${esc(j.id)} ${pill(j.status)}</h3>
      <div class="meta">
        <div><strong>Task:</strong> ${esc(j.task)}</div>
        <div>Poster: ${esc(j.poster)} · Budget: <strong>${esc(j.budget_near)} NEAR</strong> (escrowed)</div>
        ${j.quote ? `<div>Quote: ${esc(j.quote.price_near)} NEAR by ${esc(j.quote.agent_id)}</div>` : ""}
        ${j.counter ? `<div>Counter: ${esc(j.counter.price_near)} NEAR — “${esc(j.counter.reasoning)}”</div>` : ""}
        ${j.agreed_price_near ? `<div>Agreed price: ${esc(j.agreed_price_near)} NEAR</div>` : ""}
        ${j.result ? `<div>Result: ${esc(j.result.slice(0, 300))}${j.result.length > 300 ? "…" : ""}</div>` : ""}
        <div><a href="${EXPLORER}/accounts/${esc(contractId)}" target="_blank" rel="noopener">contract on explorer</a></div>
      </div>
      ${actions.length ? `<div class="row">${actions.join("")}</div>` : ""}
    </div>`;
  }).join("");
}

function renderReceipts(jobs) {
  const settled = jobs.filter((j) => j.receipt);
  const box = $("receiptsList");
  if (!settled.length) {
    box.innerHTML = `<p class="hint">No settled jobs yet — receipts appear here when a job is verified and paid (or refunded).</p>`;
    return;
  }
  box.innerHTML = settled.map((j) => {
    const r = j.receipt;
    return `<div class="receipt ${r.passed ? "" : "fail"}">
      <strong>Receipt — job #${esc(r.job_id)}</strong> · ${r.passed ? "✅ passed" : "❌ failed"}<br>
      Task: ${esc(r.task)}<br>
      Bought: ${esc(r.bought.slice(0, 200))}${r.bought.length > 200 ? "…" : ""}<br>
      From: ${esc(r.from || "(nobody)")} · Paid: <strong>${esc(r.price_near)} NEAR</strong> ·
      Refunded to poster: ${esc(r.refunded_near)} NEAR
    </div>`;
  }).join("");
}

function renderBudget(jobs) {
  let escrowed = 0, paid = 0, refunded = 0;
  for (const j of jobs) {
    escrowed += parseFloat(j.budget_near);
    if (j.receipt) {
      paid += parseFloat(j.receipt.price_near);
      refunded += parseFloat(j.receipt.refunded_near);
    }
  }
  const open = jobs.filter((j) => ["open", "quoted", "countered", "accepted", "submitted"].includes(j.status));
  const locked = open.reduce((s, j) => s + parseFloat(j.budget_near), 0);
  $("budgetSummary").innerHTML = `
    <div>Escrowed total<b>${escrowed.toFixed(4)} NEAR</b></div>
    <div>Still locked in open jobs<b>${locked.toFixed(4)} NEAR</b></div>
    <div>Paid to workers<b>${paid.toFixed(4)} NEAR</b></div>
    <div>Refunded to posters<b>${refunded.toFixed(4)} NEAR</b></div>`;
}

async function refreshAll() {
  if (!account) return;
  try {
    status($("jobsStatus"), "Loading…");
    const count = await view("get_job_count", {});
    const jobs = count > 0 ? await view("list_jobs", { from_index: 0, limit: 100 }) : [];
    renderJobs(jobs);
    renderReceipts(jobs);
    renderBudget(jobs);
    status($("jobsStatus"), `${jobs.length} job(s) · updated ${new Date().toLocaleTimeString()}`, "ok");
  } catch (e) {
    status($("jobsStatus"), `Failed to load jobs: ${e.message}`, "error");
  }
}

function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    if ($("autoRefresh").checked) refreshAll();
  }, 10_000);
}

async function postJob() {
  const task = $("taskText").value.trim();
  const budget = $("budgetNear").value.trim();
  if (!task) return status($("postStatus"), "Write a task first.", "error");
  if (!budget || parseFloat(budget) <= 0) return status($("postStatus"), "Budget must be > 0 NEAR.", "error");
  try {
    status($("postStatus"), "Posting (escrowing budget)…");
    const deposit = nearApi.utils.format.parseNearAmount(budget);
    const tx = await call("post_job", { task, budget_near: budget }, BigInt(deposit));
    status($("postStatus"), `Posted. tx ${tx}`, "ok");
    $("taskText").value = "";
    await refreshAll();
  } catch (e) {
    status($("postStatus"), `Failed: ${e.message}`, "error");
  }
}

async function jobAction(act, id) {
  try {
    let tx;
    if (act === "accept_quote") tx = await call("accept_quote", { job_id: id });
    else if (act === "reject_quote") tx = await call("reject_quote", { job_id: id });
    else if (act === "cancel") tx = await call("cancel_job", { job_id: id });
    else if (act === "verify_pass") tx = await call("verify_and_pay", { job_id: id, passed: true });
    else if (act === "verify_fail") tx = await call("verify_and_pay", { job_id: id, passed: false });
    else if (act === "counter") {
      const price = window.prompt("Counter price in NEAR (must be below the quote):");
      if (price === null) return;
      const reasoning = window.prompt("Why this price? (your reasoning goes on-chain)");
      if (reasoning === null || !reasoning.trim()) return;
      tx = await call("counter", { job_id: id, price_near: price.trim(), reasoning: reasoning.trim() });
    }
    status($("jobsStatus"), `Done. tx ${tx}`, "ok");
    await refreshAll();
  } catch (e) {
    status($("jobsStatus"), `Failed: ${e.message}`, "error");
  }
}

$("connectBtn").addEventListener("click", () => connect(false));
$("readonlyBtn").addEventListener("click", () => connect(true));
$("postBtn").addEventListener("click", postJob);
$("refreshBtn").addEventListener("click", refreshAll);
$("jobsList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (btn) jobAction(btn.dataset.act, btn.dataset.id);
});

// Restore saved connection details.
$("contractId").value = localStorage.getItem("foreman:contract") || DEFAULT_CONTRACT_ID;
$("accountId").value = localStorage.getItem("foreman:account") || "";
$("privateKey").value = localStorage.getItem("foreman:key") || "";
$("contractEcho").textContent = $("contractId").value;
