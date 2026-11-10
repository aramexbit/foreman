#!/usr/bin/env bash
# One-command end-to-end demo: build everything, then run the Foreman loop
# live against the deployed testnet contract.
# Needs .env with CONTRACT_ID + FOREMAN_* + WORKER_* (see .env.example).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Building..."
npm run build

echo "Running the Foreman loop (task + 2 NEAR budget, auto-worker)..."
node agent/dist/index.js run \
  --task "Research the best free NFT mints and write a short summary" \
  --budget 2 --auto-worker

echo ""
echo "Jobs on-chain:"
node agent/dist/index.js jobs --limit 10
