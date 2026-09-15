#!/usr/bin/env python3
"""Compile and run an off-Editor C# test harness on Unity's own .NET runtime.

Replaces the ad hoc /tmp/zkube-*/Program.cs harnesses. Sources and tests are
compiled with the Editor's Roslyn against its netstandard reference set; the
shared runner (harness/TestMain.cs) reports PASS/FAIL per NUnit case and never
lets an exception leave Main, so a red test is exit code 1 with a report, not
a SIGABRT and a core dump. Everything lands under build/unity/harness/<name>.

Example:
  python3 unity/tools/harness.py product-reads \\
    --sources unity/Assets/ZKube/Integration --exclude Android \\
    --tests unity/Assets/ZKube/Tests/EditMode/Integration \\
    --refs build/unity/harness/deps/ZKube.Core.dll ... --filter ProductRead
"""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

from cli import run_main

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
HERE = Path(__file__).resolve().parent


def editor_data():
    lock = json.loads((PROJECT / "toolchain.json").read_text())
    editor = Path(os.environ.get("UNITY_EDITOR", str(Path.home() / "Unity/Hub/Editor" / lock["editor"] / "Editor/Unity")))
    data = editor.parent / "Data"
    if not (data / "NetCoreRuntime/dotnet").is_file() or not (data / "DotNetSdkRoslyn/csc.dll").is_file():
        raise RuntimeError(f"Pinned Unity Editor {lock['editor']} has no NetCoreRuntime or Roslyn under {data}")
    return data


def collect(paths, excludes):
    files = []
    for entry in paths:
        path = (ROOT / entry) if not Path(entry).is_absolute() else Path(entry)
        if path.is_dir():
            files.extend(sorted(p for p in path.rglob("*.cs") if not any(x in p.parts for x in excludes)))
        elif path.is_file():
            files.append(path)
        else:
            raise RuntimeError(f"No such source: {entry}")
    return list(dict.fromkeys(files))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", help="harness name; output goes to build/unity/harness/<name>")
    parser.add_argument("--tests", nargs="+", required=True, help="test .cs files or directories (NUnit [Test]/[TestCase])")
    parser.add_argument("--sources", nargs="*", default=[], help="library .cs files or directories compiled into <name>.dll")
    parser.add_argument("--refs", nargs="*", default=[], help="dependency .dll files, copied beside the harness")
    parser.add_argument("--exclude", nargs="*", default=[], help="path segments to skip when collecting directories")
    parser.add_argument("--define", nargs="*", default=["ZKUBE_STANDALONE"], help="preprocessor symbols")
    parser.add_argument("--filter", default="", help="run only cases whose full name contains this text")
    parser.add_argument("--no-unity-shim", action="store_true", help="omit harness/UnityShims.cs (UnityEngine.Application)")
    parser.add_argument("--compile-only", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", args.name):
        raise RuntimeError("Harness name must be a short alphanumeric slug")

    data = editor_data()
    dotnet = data / "NetCoreRuntime/dotnet"
    runtime = sorted((data / "NetCoreRuntime/shared/Microsoft.NETCore.App").iterdir())[-1].name
    out = ROOT / "build/unity/harness" / args.name
    out.mkdir(parents=True, exist_ok=True)
    refs = sorted((data / "NetStandard/ref/2.1.0").glob("*.dll")) + sorted((data / "NetStandard/compat/2.1.0/shims/netfx").glob("*.dll"))
    nunit = sorted((PROJECT / "Library/PackageCache").glob("com.unity.ext.nunit@*/net40/unity-custom/nunit.framework.dll"))
    if not nunit:
        raise RuntimeError("nunit.framework.dll not found under unity/Library/PackageCache; open the project once")
    deps = [Path(r).resolve() for r in args.refs] + [nunit[-1]]
    for dll in deps:
        if not dll.is_file():
            raise RuntimeError(f"Missing reference: {dll}")
        target = out / dll.name
        if not target.exists() or target.read_bytes() != dll.read_bytes():
            shutil.copyfile(dll, target)
    csc = [str(dotnet), str(data / "DotNetSdkRoslyn/csc.dll"), "-nologo", "-nostdlib+", "-langversion:9", "-nullable:enable",
           "-nowarn:1701,8600,8601,8602,8603,8604,8618,8625"] + [f"-define:{d}" for d in args.define] + [f"-r:{r}" for r in refs + deps]

    def compile(kind, output, files, extra_refs=()):
        response = out / (output.stem + ".rsp")
        arguments = [f"-target:{kind}", f"-out:{output}"] + [f"-r:{r}" for r in extra_refs] + [str(f) for f in files]
        if kind == "exe":
            arguments.append("-main:ZKube.TestMain")
        response.write_text("\n".join(json.dumps(value) for value in arguments) + "\n")
        result = subprocess.run(csc + [f"@{response}"], cwd=ROOT, text=True, capture_output=True)
        (out / (output.stem + ".compile.log")).write_text(result.stdout + result.stderr)
        if result.returncode != 0:
            errors = [l for l in (result.stdout + result.stderr).splitlines() if "error" in l]
            for line in errors[:15]:
                print(line)
            raise RuntimeError(f"{output.name} did not compile ({len(errors)} errors); see {out / (output.stem + '.compile.log')}")

    library = None
    if args.sources:
        library = out / f"{args.name}.dll"
        sources = collect(args.sources, args.exclude)
        if not args.no_unity_shim:
            sources.append(HERE / "harness/UnityShims.cs")
        compile("library", library, sources)
    tests = collect(args.tests, args.exclude) + [HERE / "harness/TestMain.cs"]
    if not args.no_unity_shim and library is None:
        tests.append(HERE / "harness/UnityShims.cs")
    exe = out / "Tests.dll"
    compile("exe", exe, tests, [library] if library else [])
    (out / "Tests.runtimeconfig.json").write_text(json.dumps(
        {"runtimeOptions": {"tfm": "net" + ".".join(runtime.split(".")[:2]), "framework": {"name": "Microsoft.NETCore.App", "version": runtime}}}))
    if args.compile_only:
        print(f"Compiled {exe}")
        return
    env = dict(os.environ, NO_DNA="1", ZKUBE_UNITY_DATA_PATH=str(PROJECT / "Assets"),
               ZKUBE_UNITY_MANAGED_PATH=str(data / "Managed/UnityEngine"),
               LD_LIBRARY_PATH=str(PROJECT / "Assets/Plugins/x86_64"), DOTNET_CLI_TELEMETRY_OPTOUT="1")
    result = subprocess.run([str(dotnet), str(exe), args.filter], cwd=ROOT, env=env, text=True, capture_output=True)
    report = result.stdout + result.stderr
    (out / "results.txt").write_text(report)
    sys.stdout.write(report)
    if result.returncode not in (0, 1):
        print(f"harness process exited {result.returncode} (a crash, not a test result); see {out / 'results.txt'}")
    return 0 if result.returncode == 0 else 1


if __name__ == "__main__":
    run_main(main, result_path=ROOT / "build/unity/harness")
