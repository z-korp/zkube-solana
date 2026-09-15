"""One entry-point wrapper for the Unity tools: expected failures print one line and exit 1.

A traceback is for a bug in the script. A held lease, a missing report, a
timed-out Editor command, or a failing subprocess is an expected outcome and
must not become an unhandled exception that abrt records as a crash.
"""
import json
import subprocess
import sys
from pathlib import Path
import xml.etree.ElementTree as ET


def run_main(main, result_path=None):
    name = sys.argv[0].rsplit("/", 1)[-1]
    inspect = result_path or Path(__file__).resolve().parents[2] / "build/unity"
    try:
        result = main()
        if isinstance(result, int):
            sys.exit(result)
    except KeyboardInterrupt:
        print(f"{name}: interrupted")
        sys.exit(130)
    except SystemExit as error:
        if error.code is None or isinstance(error.code, int):
            raise
        print(f"{name}: {str(error.code).splitlines()[0]}; inspect {inspect}")
        sys.exit(1)
    except subprocess.CalledProcessError as error:
        command = error.cmd if isinstance(error.cmd, str) else str(error.cmd[0])
        print(f"{name}: CalledProcessError: {command.splitlines()[0]} exited {error.returncode}; inspect {inspect}")
        sys.exit(1)
    except (RuntimeError, TimeoutError, subprocess.TimeoutExpired, OSError,
            ET.ParseError, json.JSONDecodeError) as error:
        cause = str(error).splitlines()[0] if str(error) else type(error).__name__
        print(f"{name}: {type(error).__name__}: {cause}; inspect {inspect}")
        sys.exit(1)
