#!/usr/bin/env bash
set -euo pipefail

scope="${1:-all}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

validate_sbf() {
  cd "$root"
  # Program identity is tracked separately from the generated local keypair;
  # validate SBF + IDL without mutating either identity.
  # Anchor can currently return success even when the SBF compiler reports a
  # stack-frame overflow, so the build log is an additional hard gate.
  local anchor_log
  anchor_log="$(mktemp)"
  if ! NO_DNA=1 anchor build --ignore-keys 2>&1 | tee "$anchor_log"; then
    rm -f "$anchor_log"
    return 1
  fi
  if rg -n "Stack offset|exceeded max offset|undefined behavior|error:" "$anchor_log"; then
    rm -f "$anchor_log"
    return 1
  fi
  rm -f "$anchor_log"
}

validate_program() {
  cd "$root"
  NO_DNA=1 cargo fmt --all -- --check
  NO_DNA=1 cargo test --workspace
  NO_DNA=1 cargo clippy --workspace --all-targets -- -D warnings
  validate_sbf
}

validate_frontend() {
  cd "$root/client"
  NO_DNA=1 pnpm install --frozen-lockfile
  NO_DNA=1 pnpm run idl:check
  NO_DNA=1 pnpm run typecheck:chain
  NO_DNA=1 pnpm run build
  NO_DNA=1 pnpm exec vitest run
  NO_DNA=1 pnpm run lint
}

case "$scope" in
  program)
    validate_program
    ;;
  program-sbf)
    validate_sbf
    ;;
  frontend)
    validate_frontend
    ;;
  all)
    validate_program
    validate_frontend
    ;;
  *)
    echo "usage: $0 [program|program-sbf|frontend|all]" >&2
    exit 2
    ;;
esac
