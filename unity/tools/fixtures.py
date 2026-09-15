#!/usr/bin/env python3
"""Check or regenerate Unity native and program fixtures in order."""
import argparse
import json
import os
from pathlib import Path
import subprocess

from cli import run_main

ROOT = Path(__file__).resolve().parents[2]
def program_scenarios(action, env):
    result = subprocess.run(["cargo", "run", "--quiet", "-p", "solana", "--example", "unity-fixtures"],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, check=True, timeout=180)
    content = result.stdout.decode("utf-8")
    json.loads(content)
    path = ROOT / "fixtures/program-unity-v1.json"
    if action == "generate":
        path.write_text(content)
    elif path.read_text() != content:
        raise RuntimeError("Stale program integration fixture: " + str(path))
    print("Program integration scenarios: " + action + " passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "generate"))
    args = parser.parse_args()
    env = dict(os.environ, NO_DNA="1")
    subprocess.run(["cargo", "run", "-p", "zkube-codegen", "--", args.action], cwd=ROOT, env=env, check=True)
    program_scenarios(args.action, env)
    print(f"Unity fixtures: native and program integration scenarios {args.action} passed")


if __name__ == "__main__":
    run_main(main, ROOT / "fixtures")
