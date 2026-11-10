# Demo — Foreman, 2 minutes

One complete moment: from a real user action to a visible result. No intro slides,
no architecture talk. Record the terminal (and the dashboard for the last 20s).

## Setup before recording (30s, off-camera)

```sh
cd foreman
npm install && npm run build
cp .env.example .env   # filled with CONTRACT_ID=foreman-ct-261110a.testnet
                       # + foreman + worker testnet accounts (faucet-funded)
```

## The 2-minute flow

**0:00–0:15 — The user action.**
In the terminal, run:

```sh
node agent/dist/index.js run \
  --task "Research the best free NFT mints and write a short summary" \
  --budget 2 --auto-worker
```

Say: "I give Foreman a task and a 2 NEAR budget. It has to hire help, stay inside
the budget, and prove what it bought."

**0:15–0:45 — The plan and the hire.**
The terminal shows the plan: 2 subtasks (research 0.7385 NEAR, writing 0.8615 NEAR),
20% kept as a verification margin. Job #1 is posted with its budget escrowed.
Then the worker quotes **0.9231 NEAR — 25% over the plan**.

**0:45–1:15 — The negotiation (the moment).**
Foreman **counters once, at 0.7385 NEAR, with its reasoning on screen**:
"Your quote is above my planned spend… I can pay 0.7385 NEAR — that keeps the
whole task inside the 2 NEAR budget." The worker accepts the counter. Job #2's
quote comes in at plan and is accepted straight away.

**1:15–1:45 — The check and the payment.**
The worker submits its work. Foreman runs its check (length + expected terms) —
"PASSED" — and the contract settles on-chain: the worker is paid the agreed price,
the unspent escrow is refunded. A receipt prints for each job: what was bought,
from whom, at what price, pass/fail, refund.

**1:45–2:00 — The proof.**
The totals line: "Spent 1.60 NEAR paid to workers, refunded 0.40 NEAR, within
budget: YES." Cut to the dashboard (http://localhost:3000, read-only): the same
jobs, the budget summary, and the receipts. End card: repo link + contract
`foreman-ct-261110a.testnet` on testnet.

## What the viewer should take away

- The budget is escrowed on-chain before any work starts.
- The negotiation is real and on-chain: an over-budget quote gets countered once,
  with reasoning, and the agreed price must fit the escrow.
- The money only moves when the work passes the check — and every job leaves a receipt.

## If something goes wrong live

Every step prints a `testnet.nearblocks.io/txns/…` link; if a step fails, the CLI
prints the contract's exact error (for example, a counter above the budget is
rejected by the contract). Re-run `npm run build` and the same command; jobs are
numbered sequentially, so a fresh run just continues from the next id.
