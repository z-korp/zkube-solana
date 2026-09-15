#!/usr/bin/env python3
"""Check or regenerate Unity native, transport and presentation fixtures in order."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from cli import run_main

ROOT = Path(__file__).resolve().parents[2]
# RPC reads Solana output; economy reads planner output; run-client reads both
# planner and reconciliation output. Parallel writes can bless stale inputs.
PRODUCERS = ("solana", "profile-identity", "planner", "rpc", "run-reconciliation", "session", "run-client", "product-read", "public-daily", "readiness", "provisional-board",
             "local-persistence", "local-run", "store-billing", "store-page", "theme", "audio", "money-overview", "campaign-browse", "money-session", "money-playable", "money-economy", "money-claim", "money-profile")


def profile_eligibility(action, env):
    # Call the program's eligibility methods: the legacy money presentation
    # once confused opening a realm with earning its guardian emblem.
    result = subprocess.run(["cargo", "run", "--quiet", "-p", "solana", "--example", "profile-fixtures"],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, check=True, timeout=180)
    oracle = json.loads(result.stdout)
    oracle["sources"] = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (
        "programs/solana/examples/profile-fixtures.rs", "programs/solana/src/state/protocol.rs",
        "crates/zkube-core/src/campaign.rs")}
    path = ROOT / "fixtures/unity-profile-eligibility-v1.json"
    content = json.dumps(oracle, indent=2) + "\n"
    if action == "generate":
        path.write_text(content)
    elif path.read_text() != content:
        raise RuntimeError("Stale program profile eligibility fixture: " + str(path))
    print("Profile eligibility: program oracle " + action + " passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "generate"))
    args = parser.parse_args()
    env = dict(os.environ, NO_DNA="1", ZKUBE_WRITE_UNITY_FIXTURES="1" if args.action == "generate" else "0")
    subprocess.run(["cargo", "run", "-p", "zkube-codegen", "--", args.action], cwd=ROOT, env=env, check=True)
    profile_eligibility(args.action, env)
    files = [f"tools/unity/{name}-fixtures.test.ts" for name in PRODUCERS]
    files.append("tools/unity/store-share-agreement.test.ts")
    batches = [[name] for name in files] if args.action == "generate" else [files]
    for batch in batches:
        subprocess.run(["pnpm", "exec", "vitest", "run", *batch], cwd=ROOT / "client", env=env, check=True)
    evidence = ROOT / "unity/Assets/ZKube/Runtime/Presentation/Evidence/generate_evidence.py"
    subprocess.run([sys.executable, str(evidence), *(["--check"] if args.action == "check" else [])],
                   cwd=ROOT, env=env, check=True)
    print(f"Unity fixtures: native, {len(files)} agreement suites and presentation {args.action} passed")


if __name__ == "__main__":
    run_main(main, ROOT / "fixtures")
