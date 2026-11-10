# HACKATHON.md — NEAR HACKATHON 2026

## Project

- **Name:** Foreman
- **Track:** Agent Economy (`agents`) — "Give AI a wallet"
- **What:** a general-contractor agent. Task + budget in NEAR → breaks the task into
  parts → hires worker agents → negotiates (counters once with reasoning if a quote
  is above the plan, then accepts or walks away) → checks the work → pays out
  within budget → receipt for every job.
- **Team size:** 1 (solo)
- **Network:** NEAR testnet only. No mainnet deployment, no real money.

## Why this track

The Agent Economy prompt asks for exactly this loop: an agent that is given a task
and a budget, hires other agents or pays for data, negotiates, checks the work and
pays out — everything inside the budget. Foreman implements the loop end-to-end,
with the escrow, the negotiation and the receipt enforced by an on-chain contract
rather than by convention.

## What was built during the hackathon window (1–14 Nov 2026)

- `contract/src/index.ts` — Foreman escrow contract (near-sdk-js, TypeScript).
  post_job (escrow) / quote / counter (once) / accept_quote / accept_counter /
  reject_quote / reject_counter / cancel_job / submit_work / verify_and_pay /
  get_job / list_jobs / get_receipt / get_job_count.
- `agent/src/` — Foreman agent CLI (near-api-js): rule-based task breakdown,
  planned spend per subtask, one counter with reasoning, deterministic work check,
  settlement, receipts.
- `frontend/` — dashboard (plain HTML/JS + near-api-js): create task, list jobs,
  budget summary, receipts, poster actions.
- `test/logic.test.mjs` — 7 unit tests (amount math, breakdown, verification).
- `demo/DEMO.md` — the 2-minute demo flow.

## Libraries / templates used (baseline, not built in the window)

- `near-sdk-js` 2.0.0, `near-api-js` 5.1.1, `near-cli` 4.0.13, `typescript` 5.6.3,
  `esbuild` 0.25.5, `buffer` 6.0.3, `util` 0.12.5 (all public npm packages, pinned
  in `package.json` / `package-lock.json`).
- No starter template was used; all product code in `contract/`, `agent/`,
  `frontend/`, `shared/` was written in the window.

## Deployed (testnet)

- Contract: **`foreman-ct-261110a.testnet`**
  Explorer: https://testnet.nearblocks.io/accounts/foreman-ct-261110a.testnet
  Deploy tx: `BcYVa9jmNXUh6znggGru1osJcaHHUsJ6nyMNiFo3HSGp`
- Foreman (poster) account: `foreman-261110a.testnet`
- Demo worker account: `worker-261110a.testnet`
- All three accounts were created with free testnet faucet NEAR. No mainnet keys
  exist for this project.

## Reproducibility (for the screening agents)

See README.md, section "Do X — see Y". In short:

```sh
npm install && npm test && npm run build
node agent/dist/index.js run --task "Research the best free NFT mints and write a short summary" --budget 2 --auto-worker
```

That runs the whole loop live against the deployed testnet contract and prints a
transaction link for every step plus a receipts file under `runs/`. It needs a
`.env` with `CONTRACT_ID` and two funded testnet accounts (see `.env.example`);
testnet NEAR is free from the faucet.

## Submission checklist (human steps — not done by the agent)

- [ ] Repository is public by 14 Nov 2026 23:59 UTC.
- [ ] Demo post published on X by the human: says built at NEAR HACKATHON, tags
      @NEARProtocol and #NEARHackathon, video or screenshots attached.
- [ ] Submission payload confirmed by the human, then POST to
      https://nearhackathon.com/api/applications (one submission per project).
- [ ] NEAR mainnet payout account: created by the human in a NEAR wallet, never
      invented by the agent.
- [ ] Demo stays up through judging (18 Nov, ideally 25 Nov).

## Rules noted

- Q-010: testnet-only projects are eligible in all tracks. This project is
  testnet-only by design.
- Q-011: no mandatory integrations; an own contract on NEAR that fits the track
  is enough. Foreman uses its own contract only.
- Q-012: local-only demo is OK with a public repo + reproducible README + X post
  with video; a hosted demo is a plus.
- Q-014: MIT license, `LICENSE` included; repo stays public through judging.
- Q-017: Claude Code / Codex screen first — the README is written for a machine
  reader too ("do X — see Y" steps, no marketing).
