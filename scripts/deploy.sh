#!/usr/bin/env bash
# Deploy the Foreman contract to NEAR testnet and initialize it.
# Reads .env for CONTRACT_ID (and the deployer key via FOREMAN_KEY_FILE /
# FOREMAN_PRIVATE_KEY is NOT used here — near-cli uses ~/.near-credentials).
# Testnet only. Never point this at mainnet.
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env if present (CONTRACT_ID)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

CONTRACT_ID="${CONTRACT_ID:-foreman-ct-261110a.testnet}"
WASM="build/contract.wasm"

echo "Building contract..."
npm run build:contract

if [ ! -f "$WASM" ]; then
  echo "Build failed: $WASM not found" >&2
  exit 1
fi

# If the contract account has no credentials locally, create it via the faucet.
if [ ! -f "$HOME/.near-credentials/testnet/${CONTRACT_ID}.json" ]; then
  echo "No local credentials for ${CONTRACT_ID}; creating it via the testnet faucet..."
  ./node_modules/.bin/near create-account "${CONTRACT_ID}" --useFaucet --networkId testnet
fi

echo "Deploying to ${CONTRACT_ID} (testnet)..."
./node_modules/.bin/near deploy "${CONTRACT_ID}" "${WASM}" \
  --initFunction init --initArgs '{}' --networkId testnet

echo "Verifying..."
./node_modules/.bin/near view "${CONTRACT_ID}" get_job_count '{}' --networkId testnet
echo "Deployed: ${CONTRACT_ID}"
echo "Explorer: https://testnet.nearblocks.io/accounts/${CONTRACT_ID}"
