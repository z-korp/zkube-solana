#!/usr/bin/env python3
"""Send one bounded evidence command to the running graphics Unity Editor."""
import argparse
import json
from pathlib import Path
import time
import uuid

from cli import run_main

ROOT = Path(__file__).resolve().parents[2]
COMMANDS = ROOT / "build/unity/editor-commands"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MONEY_SCENARIOS = ("public-disconnected", "owner-overview", "pending-confirmed-failure",
                   "session-enable-success", "session-enable-pending-failure", "session-refill-success",
                   "session-current", "session-disable-pending-success", "session-disable-zero",
                   "session-owner-decline", "session-fee-shortage", "session-renew-expired", "campaign-playable", "daily-playable",
                   "kredit-buy-1", "kredit-buy-10", "kredit-buy-25", "kredit-owner-decline", "kredit-fee-shortage",
                   "kredit-pending-success", "kredit-pending-failure",
                   "claim-score-sealed",
                   "claim-score-deadline",
                   "claim-score-expired",
                   "claim-score-claims-expired",
                   "claim-score-unsealed",
                   "claim-score-claimed",
                   "claim-score-missing-session",
                   "claim-score-pending-success",
                   "claim-score-pending-failure",
                   "claim-theme-sealed",
                   "claim-theme-deadline",
                   "claim-theme-expired",
                   "claim-theme-claims-expired",
                   "claim-theme-unsealed",
                   "claim-theme-claimed",
                   "claim-theme-missing-session",
                   "claim-theme-pending-success",
                   "claim-theme-pending-failure",
                   "profile-success", "profile-auto", "profile-border-only", "profile-explicit-auto-target", "profile-fresh",
                   "profile-confirmed-failure", "profile-pending-success", "profile-pending-failure", "profile-missing-session", "profile-superseded")


def command(action, **arguments):
    COMMANDS.mkdir(parents=True, exist_ok=True)
    request = COMMANDS / "request.json"
    if request.exists():
        raise RuntimeError(f"An evidence command is already queued at {request}; wait for {COMMANDS / 'response.json'}")
    identifier = uuid.uuid4().hex
    temporary = COMMANDS / (identifier + ".tmp")
    temporary.write_text(json.dumps(dict(id=identifier, action=action, **arguments)))
    # link fails instead of overwriting another caller's queued command.
    try:
        request.hardlink_to(temporary)
    finally:
        temporary.unlink()
    deadline = time.monotonic() + 45
    response = COMMANDS / "response.json"
    while time.monotonic() < deadline:
        if response.exists():
            # Bound before allocation/parsing, including a nested JSON result.
            with response.open("rb") as stream:
                payload = stream.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise RuntimeError(f"Evidence response exceeds 4 MiB at {response}; request a smaller region or an artifact path")
            value = json.loads(payload)
            if value["id"] == identifier:
                if value["status"] != "ok":
                    raise RuntimeError(value["result"])
                try:
                    value["result"] = json.loads(value["result"])
                except ValueError:
                    pass
                return value
        time.sleep(0.1)
    raise TimeoutError(f"Command {identifier} has no observed completion; wait for {response}; Editor log: {ROOT / 'build/unity/board-gui.log'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["open", "readiness", "load", "viewport", "input", "legal-input", "click", "profile", "profiler-export", "capture", "journey", "fault-journey", "settings", "advance", "sample-start", "sample-end", "mcp-settings", "exit"])
    parser.add_argument("--surface", choices=["board", "money"], default="board")
    parser.add_argument("--fixture")
    parser.add_argument("--control")
    parser.add_argument("--scenario", choices=["native-rejection", "queued-discard", "uncertain-recovery", *MONEY_SCENARIOS])
    parser.add_argument("--outcome", choices=["failure", "success"])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--raw", type=Path)
    parser.add_argument("--width", type=int, default=430)
    parser.add_argument("--height", type=int, default=932)
    parser.add_argument("--frames", type=int, default=300)
    parser.add_argument("--inputs", type=int, default=1)
    parser.add_argument("--seconds", type=float, default=15)
    parser.add_argument("--text-scale", type=float, choices=[1.0, 1.3], default=1.0)
    parser.add_argument("--muted", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--reduced-motion", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--haptics", action=argparse.BooleanOptionalAction, default=False)
    args = parser.parse_args()
    if args.surface == "money" and args.action not in ("open", "readiness", "load", "viewport", "click", "input", "advance", "capture", "journey", "exit"):
        parser.error("unsupported money evidence action")
    if args.surface == "money" and args.action == "load" and args.scenario not in MONEY_SCENARIOS:
        parser.error("money load requires a money --scenario")
    if args.outcome and (args.surface != "money" or args.action != "advance"):
        parser.error("--outcome requires a money advance operation")
    if args.surface == "board" and args.action == "advance":
        parser.error("advance is a money fixture operation")
    if args.surface == "board" and args.action == "load" and not args.fixture:
        parser.error("load requires --fixture")
    if args.action == "click" and not args.control:
        parser.error("click requires --control")
    if args.action == "fault-journey" and not args.scenario:
        parser.error("fault-journey requires --scenario")
    if args.action == "profiler-export" and not args.raw:
        parser.error("profiler-export requires --raw")
    if args.action in ("profile", "profiler-export", "capture", "journey", "fault-journey", "sample-end") and not args.output:
        parser.error(f"{args.action} requires --output")
    values = vars(args)
    values["reducedMotion"] = values.pop("reduced_motion")
    values["textScale"] = values.pop("text_scale")
    if args.output:
        values["output"] = str(args.output.resolve())
    if args.raw:
        values["raw"] = str(args.raw.absolute())
    print(json.dumps(command(**values), indent=2))


if __name__ == "__main__":
    run_main(main, COMMANDS / "response.json")
