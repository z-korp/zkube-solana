#!/usr/bin/env bash
set -euo pipefail

scope="${1:-all}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

validate_documentation_layout() {
  cd "$root"
  local path
  local -a markdown=()
  while IFS= read -r path; do
    if [[ -e "$path" || -L "$path" ]]; then
      markdown+=("$path")
    fi
  done < <(git ls-files --cached --others --exclude-standard '*.md' | sort)
  local actual
  actual="$(printf '%s\n' "${markdown[@]}")"
  local expected=$'AGENTS.md\nCLAUDE.md\nREADME.md'
  if [[ "$actual" != "$expected" ]]; then
    echo "only README.md, AGENTS.md, and CLAUDE.md may exist as Markdown" >&2
    printf 'found:\n%s\n' "$actual" >&2
    return 1
  fi
  if [[ ! -L CLAUDE.md || "$(readlink CLAUDE.md)" != "AGENTS.md" ]]; then
    echo "CLAUDE.md must be a relative symlink to AGENTS.md" >&2
    return 1
  fi
}

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
  local diagnostic_pattern="Stack offset|exceeded max offset|undefined behavior|error:"
  local -a diagnostic_scan
  if command -v rg >/dev/null 2>&1; then
    diagnostic_scan=(rg -n "$diagnostic_pattern")
  else
    diagnostic_scan=(grep -En "$diagnostic_pattern")
  fi
  if "${diagnostic_scan[@]}" "$anchor_log"; then
    rm -f "$anchor_log"
    return 1
  fi
  rm -f "$anchor_log"
  # Execute the compiled ELF directly in a minified SVM. This covers real SBF
  # account/instruction behavior without a validator, RPC, signatures, or
  # sent transactions.
  SBF_OUT_DIR="$root/target/deploy" NO_DNA=1 \
    cargo test --features sbf-tests --test sbf_contract
}

validate_program() {
  cd "$root"
  NO_DNA=1 cargo fmt --all -- --check
  NO_DNA=1 cargo test --workspace
  NO_DNA=1 cargo clippy --workspace --all-targets -- -D warnings
  validate_sbf
}

validate_frontend() {
  cd "$root/services"
  NO_DNA=1 pnpm install --frozen-lockfile
  NO_DNA=1 pnpm run build
  cd "$root/client"
  NO_DNA=1 pnpm install --frozen-lockfile
  NO_DNA=1 pnpm run idl:check
  NO_DNA=1 pnpm run typecheck:chain
  NO_DNA=1 pnpm run build
  NO_DNA=1 pnpm exec vitest run
  NO_DNA=1 pnpm run lint
}

validate_documentation_layout

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
