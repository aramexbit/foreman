# Foreman — a general-contractor AI agent on NEAR

> **Built at NEAR HACKATHON 2026 · Track: Agent Economy (`agents`) — "Give AI a wallet"**
> Prize pool $250,000 · Development ends 14 Nov 2026 23:59 UTC.

## What it is

Foreman is a general-contractor agent. You give it **a task and a budget in NEAR**.
It breaks the task into parts, decides which parts to do itself and which to buy,
hires worker agents, **negotiates** (if a quote comes in above the planned spend it
counters **once**, with reasoning, then accepts or walks away), checks the work,
pays out **within budget**, and leaves a **receipt for every job**: what was bought,
from whom, at what price, and whether the work passed the check.

## The problem

AI agents can already hold wallets, but hiring is still a leap of faith: you pay
upfront and hope. There is no escrow, no negotiation, and no receipt. Foreman
makes agent-to-agent hiring safe and auditable: the budget is escrowed on-chain,
the price is agreed on-chain, and the money only moves when the work passes a check.

## How NEAR fits (concretely)

- **Escrow + settlement in NEAR.** `post_job` escrows the budget in the contract;
  `verify_and_pay` releases it. No custodian, no off-chain payment rail.
- **Negotiation is on-chain state.** Quote → counter (once, with reasoning) →
  accept / walk away are contract calls, so the whole haggle is auditable.
- **Named accounts as agent identity.** The poster and the worker are NEAR
  accounts; the receipt names the worker account that was paid.
- **Testnet-only.** Everything here runs on NEAR testnet with free faucet NEAR.
  No mainnet, no real money.

## Do X — see Y (reproduce the demo)

Prerequisites: Node 20+, npm. No Rust needed. All commands run from this repo root.

```sh
npm install            # installs near-sdk-js, near-api-js, near-cli, typescript, esbuild
npm test               # 7 unit tests (amount math, task breakdown, verification)
npm run build          # builds contract wasm + agent CLI + frontend bundle
```

### 1. See the deployed contract (no setup)

- Contract: **`foreman-ct-261110a.testnet`** (NEAR testnet)
- Explorer: https://testnet.nearblocks.io/accounts/foreman-ct-261110a.testnet
- Check it answers: `npx near view foreman-ct-261110a.testnet get_job_count '{}' --networkId testnet`
  → `0` on a fresh deploy; grows as jobs are posted.

### 2. Run the agent end-to-end (the full loop, live on testnet)

```sh
cp .env.example .env    # then fill in CONTRACT_ID + two funded testnet accounts
npm run build:agent
node agent/dist/index.js run --task "Research the best free NFT mints and write a short summary" --budget 2 --auto-worker
```

You will see, in order: the plan (subtasks + planned spend) → each job posted
with its budget escrowed → the worker's quote → **the counter** (first quote comes
in 25% over plan, so Foreman counters once at the plan, with reasoning) → worker
accepts → work submitted → Foreman's check (pass/fail + why) → settlement on-chain
→ a receipt per job → a totals line proving spend ≤ budget. Every step prints a
`testnet.nearblocks.io/txns/…` link. Receipts are also saved to `runs/run-<timestamp>.json`.

Do X: `node agent/dist/index.js jobs` — see Y: the jobs above, with status, quote,
counter and receipt, read straight from the contract.

Do X: `node agent/dist/index.js receipt --id 1` — see Y: the receipt for job #1
(what was bought, from whom, price, pass/fail, refund).

### 3. Open the dashboard

```sh
npm run build:frontend
npx serve -l 3000 frontend     # or: python3 -m http.server 3000 -d frontend
# open http://localhost:3000
```

Do X: paste the contract id (`foreman-ct-261110a.testnet`), click **Browse read-only**
— see Y: jobs, budget summary (escrowed / locked / paid / refunded) and receipts.
Do X: connect with a funded testnet key and post a task with a budget — see Y: the
new job appears with its budget escrowed, and the poster actions (accept / counter /
verify) appear on your jobs.

### 4. The demo flow (2 minutes)

See `demo/DEMO.md` — one complete moment, from a real user action to a visible result.

### Verified end-to-end run (testnet, 10 Nov 2026)

Task: "Research the best free NFT mints and write a short summary", budget 2 NEAR.
Jobs #3 and #4 on `foreman-ct-261110a.testnet` (full log: `runs/e2e-full-log.txt`):

| Step | Job | Tx |
|---|---|---|
| post job (0.7385 NEAR escrowed) | #3 | `Eq5J6KSJEBwcBpNsEWM6VSupkdTuR2d5CfRSF266FSNt` |
| worker quotes 0.9231 NEAR (25% over plan) | #3 | `53FxdS7UYzF5ACVK4JDQvPE4pAJiQ1MveG5hzpDwDLeo` |
| Foreman counters once at 0.7385 NEAR, with reasoning | #3 | `FXuqxUJg3NNKc1nMqup7fooLjoPLntcYJ2LEgm75KSjL` |
| worker accepts the counter | #3 | `H9KmnTcMky2R28tmbxsxbYC59uu9EdTcbGev3h8BvNgR` |
| worker submits work (569 chars) | #3 | `F6Dbs9bapTtpBoW6pNcsrWrTYRsM766Y2u3wihcUvexG` |
| check PASSED, settled on-chain (0.7385 NEAR paid) | #3 | `8zzN35W8efYJUFskQsE5VpqwVWVS1YoRKD1bW8D54Kzv` |
| post job (0.8615 NEAR escrowed) | #4 | `FJap8EaTmFyRq1mmvCbCASXRTWU3KhQ92a9TQXt6ANbi` |
| worker quotes 0.8615 NEAR (at plan) | #4 | `HNGi7we28NM6J9jqff7CFKaNUrgbeZ4drFg2s8Gnftki` |
| quote accepted at 0.8615 NEAR | #4 | `qH8jfA6edV8QLgNxeyM4Vk6h68Qg5t562dknQLGaecH` |
| worker submits work (451 chars) | #4 | `GkADuArxfrdBT5WCu3iNjZS3GP6HvFPgaYcnY6Mm1zQF` |
| check PASSED, settled on-chain (0.8615 NEAR paid) | #4 | `AaoikJMHuTcKUD5gtNw6pxnsbcFDcQuBPF64bE2jt67w` |

Totals: spent 1.6000 NEAR paid to workers, refunded 0 NEAR, within budget: YES.
Receipts: `runs/run-2026-11-10T03-47-06-375Z.json`. All links:
`https://testnet.nearblocks.io/txns/<hash>`.

## How it works

```
User task + budget (NEAR)
        │
        ▼
Foreman agent (agent/src/index.ts)
  ├─ breakdownTask() — rule-based split into subtasks, planned spend each
  │   (20% of the budget is kept as a verification margin; it is refunded)
  ├─ post_job() — one escrowed job per subtask
  ├─ quote() — worker quotes a price (may be above the plan)
  ├─ counter() — Foreman counters ONCE, at the plan, with reasoning
  │   (contract enforces: one counter only, counter < quote, counter ≤ budget)
  ├─ accept_quote() / accept_counter() — or reject_*() to walk away
  ├─ submit_work() — worker submits its result
  ├─ verify_and_pay() — Foreman checks the work (deterministic check:
  │   length + expected terms) and the contract settles:
  │   passed → worker is paid the agreed price, rest refunded
  │   failed → worker is paid 0, full budget refunded
  └─ get_receipt() — what was bought, from whom, price, pass/fail, refund
        │
        ▼
Foreman contract (contract/src/index.ts, near-sdk-js, TypeScript)
  Deployed: foreman-ct-261110a.testnet (testnet)
```

**Negotiation rule, enforced by the contract (not just the agent):**
a quote may be above the escrowed budget (that is what makes a counter meaningful);
the *agreed* price must fit the escrow (`accept_quote` and `counter` both reject a
price above the budget). One counter per job, then accept or walk away.

**Verification check (deterministic, on the agent side):** submitted work passes if
it is non-empty, at least the subtask's minimum length, and mentions at least one
expected term for that kind of work. The reason is printed and the receipt records
pass/fail. A real worker agent would plug in its own checker; the contract only
needs the boolean.

**Worker output in the demo:** the built-in demo worker generates placeholder
deliverables (`agent/src/breakdown.ts: generateWork()`). The hiring, negotiation,
escrow, verification and payment are all real and on-chain; the prose is a stand-in.
An optional OpenAI-compatible LLM can be plugged in via `LLM_API_URL` + `LLM_API_KEY`
(see `.env.example`); when unset, the rule-based generator is used.

## Project layout

```
contract/src/index.ts     Foreman escrow contract (near-sdk-js, TypeScript)
agent/src/index.ts        Foreman agent CLI (run/post/jobs/receipt/quote/work/verify/counter)
agent/src/near.ts         NEAR testnet connection helpers (near-api-js)
agent/src/breakdown.ts    rule-based task breakdown, verification check, demo worker
shared/amounts.ts         NEAR amount parsing/formatting (used by contract + tests)
frontend/                 dashboard: index.html + style.css + src/app.js (esbuild → bundle.js)
test/logic.test.mjs       unit tests (node --test)
scripts/deploy.sh         build + deploy to testnet + init
scripts/demo-e2e.sh       one-command end-to-end demo run
demo/DEMO.md              exact 2-minute demo flow for the video
HACKATHON.md              hackathon notes (tracks, rules, submission checklist)
```

## Deploy it yourself (testnet, free)

```sh
npm run build:contract
bash scripts/deploy.sh    # creates/funds a testnet account if needed, deploys, inits
```

`scripts/deploy.sh` reads `.env` (`CONTRACT_ID`, plus the deployer key via
`FOREMAN_KEY_FILE`/`FOREMAN_PRIVATE_KEY`). Testnet NEAR is free from the faucet
(`near create-account <name>.testnet --useFaucet` or https://near-faucet.io).
Never deploy to mainnet from this repo; there is no mainnet configuration.

## Known limitations (honest)

- The demo worker generates placeholder deliverables; a production worker would
  do real work. The escrow/negotiation/payment loop is real.
- `verify_and_pay` attaches the payouts with `.build()` (they execute as receipts
  in the same transaction); if a payout to a deleted account failed, the receipt
  would still say paid. In practice the worker account exists (it quoted).
- The dashboard's "connect" pastes a testnet private key into the browser. That is
  fine for a testnet demo key, but never paste a mainnet key into any web page.
- The contract stores jobs in an `UnorderedMap`; `list_jobs` pages by id.
  A job id is a simple counter, so ids are sequential from 1.

## License

MIT — see `LICENSE`.

## Links

- Hackathon: https://nearhackathon.com — rules: https://nearhackathon.com/HACKATHON.md
- Agent Economy starter prompt: https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/07-agents.md
- NEAR docs: https://docs.near.org/
