#!/usr/bin/env bash
# Builds badge_escrow for deployment.
#
# Two steps, on purpose:
#   1. `anchor build` produces the IDL and TypeScript types, but the platform
#      tools it pins (v1.52) only reach SBPFv2 and emit an SBPFv0 binary.
#   2. SIMD-0500 disables deployment of SBPFv0/v1/v2, so the `.so` is rebuilt
#      with `cargo-build-sbf --arch v3` (platform-tools v1.54) to get a
#      deployable artifact.
#
# The IDL is then copied into packages/chain so the TS client's discriminators
# always match the deployed program.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

cd "$ROOT/program"
anchor build
cd "$ROOT/program/programs/badge_escrow"
cargo-build-sbf --arch v3

cp "$ROOT/program/target/idl/badge_escrow.json" "$ROOT/packages/chain/src/idl/badge_escrow.json"

FLAGS=$(xxd -s 48 -l 4 -p "$ROOT/program/target/deploy/badge_escrow.so")
if [ "$FLAGS" != "03000000" ]; then
  echo "error: badge_escrow.so is not SBPFv3 (e_flags=$FLAGS); it will fail to deploy" >&2
  exit 1
fi
echo "built badge_escrow (SBPFv3) + IDL"
