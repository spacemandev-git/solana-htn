#!/usr/bin/env bash
# Boots a local validator, deploys badge_escrow, and prints the env the server needs.
#
# Usage: ./scripts/localnet.sh [start|stop|env]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYS="$ROOT/.solana-keys"
LEDGER="$ROOT/program/test-ledger"
RPC="http://127.0.0.1:8899"
PROGRAM_SO="$ROOT/program/target/deploy/badge_escrow.so"
PROGRAM_KEYPAIR="$ROOT/program/target/deploy/badge_escrow-keypair.json"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

start() {
  mkdir -p "$KEYS"
  [ -f "$KEYS/authority.json" ] || solana-keygen new --no-bip39-passphrase -s -o "$KEYS/authority.json" >/dev/null

  if ! curl -s "$RPC" -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' >/dev/null 2>&1; then
    echo "starting solana-test-validator..."
    rm -rf "$LEDGER"
    solana-test-validator --ledger "$LEDGER" --reset --quiet >"$ROOT/.solana-keys/validator.log" 2>&1 &
    for _ in $(seq 1 60); do
      sleep 1
      curl -s "$RPC" -X POST -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' >/dev/null 2>&1 && break
    done
  fi

  "$ROOT/scripts/build-program.sh" >/dev/null

  solana airdrop 100 --keypair "$KEYS/authority.json" --url "$RPC" >/dev/null
  solana program deploy "$PROGRAM_SO" \
    --program-id "$PROGRAM_KEYPAIR" --keypair "$KEYS/authority.json" --url "$RPC" >/dev/null
  echo "deployed badge_escrow"
  env_vars
}

stop() {
  pkill -f solana-test-validator || true
  echo "validator stopped"
}

env_vars() {
  echo "SOLANA_RPC_URL=$RPC"
  echo "SOLANA_PROGRAM_ID=$(solana address -k "$PROGRAM_KEYPAIR")"
  echo "SOLANA_AUTHORITY_SECRET_KEY=$(bun "$ROOT/scripts/to-base58.ts" "$KEYS/authority.json")"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  env) env_vars ;;
  *) echo "usage: $0 [start|stop|env]" >&2; exit 1 ;;
esac
