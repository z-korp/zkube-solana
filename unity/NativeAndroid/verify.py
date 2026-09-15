#!/usr/bin/env python3
"""Build/test only the native library; no Unity Editor or wallet is launched."""
import argparse
import os
from pathlib import Path
import subprocess
import hashlib
import json
import xml.etree.ElementTree as ET

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from cli import run_main


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-locks", action="store_true")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent
    import build
    shared = vars(build)
    editor, android = shared["toolchain"]()
    java_home = android / "OpenJDK"
    gradle = android / "Tools/gradle/lib" / f'gradle-launcher-{shared["LOCK"]["gradle"]}.jar'
    sdk = android / "SDK"
    for path in (java_home / "bin/java", gradle, sdk):
        if not path.exists():
            raise SystemExit(f"Missing pinned Unity Android tool: {path}")
    env = {key: value for key, value in os.environ.items() if key in {"HOME", "USER", "LANG", "LC_ALL", "PATH", "GRADLE_USER_HOME"}}
    env.update(NO_DNA="1", JAVA_HOME=str(java_home), ANDROID_HOME=str(sdk))
    command = [str(java_home / "bin/java"), "-classpath", str(gradle), "org.gradle.launcher.GradleMain",
               "--no-daemon", "--console=plain", "testDebugUnitTest", "assembleRelease"]
    if args.write_locks:
        command.append("--write-locks")
    subprocess.run(command, cwd=project, env=env, check=True)
    results = [ET.parse(path).getroot() for path in (project / "build/test-results/testDebugUnitTest").glob("TEST-*.xml")]
    tests = sum(int(result.attrib["tests"]) for result in results)
    if not tests or any(int(result.attrib.get(key, "0")) for result in results for key in ("failures", "errors", "skipped")):
        raise SystemExit("Native wallet offline tests did not all pass")
    artifact = project / "build/outputs/aar/zkube-unity-wallet-release.aar"
    source_paths = [path for path in project.rglob("*") if path.is_file() and not any(part in {"build", ".gradle"} for part in path.relative_to(project).parts)]
    source_paths.append(project.parent / "toolchain.json")
    report = {"schemaVersion": 1, "tests": tests, "externalWalletTested": False, "androidKeystoreHardwareTested": False,
              "toolchain": shared["LOCK"], "artifact": str(artifact.relative_to(project.parent.parent)),
              "artifactSha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
              "sources": {str(path.relative_to(project.parent.parent)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(source_paths)}}
    (project / "build/verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Native wallet offline: {tests}/{tests} passed")


if __name__ == "__main__":
    run_main(main, Path(__file__).resolve().parent / "build/verification.json")
