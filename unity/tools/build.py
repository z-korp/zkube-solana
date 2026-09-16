#!/usr/bin/env python3
"""Build the native dependencies and run the pinned Unity project serially."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

from android_identity import identity, abis
from cli import run_main
from editor_lease import editor_lease, INHERITED_FD

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
LOCK = None
OUTPUT = ROOT / "build" / "unity"


def run(args, **kwargs):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True, **kwargs)


def missing_test_filters(report, selection):
    # NUnit permits semicolon-separated names or patterns. A nonempty report
    # alone does not prove that every requested suite was selected.
    names = [case.get("fullname", "") for case in report.iter("test-case")]
    missing = []
    for selected in selection.split(";"):
        if not selected:
            raise RuntimeError("Empty Unity test filter")
        try:
            pattern = re.compile(re.escape(selected) if re.fullmatch(r"[\w.]+", selected) else selected)
        except re.error as error:
            raise RuntimeError("Cannot verify Unity test filter: " + selected) from error
        if not any(pattern.search(name) for name in names):
            missing.append(selected)
    return missing


def editor_run(args, log, env, completed=None):
    """A fresh result proves completion; an exit code alone cannot do that."""
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text("")
    result = subprocess.run([str(arg) for arg in args] + ["-logFile", str(log)], cwd=ROOT, env=env)
    if result.returncode:
        # Read the log before classifying the exit, without flooding the console.
        with log.open("rb") as stream:
            stream.seek(max(0, log.stat().st_size - 32768))
            tail = stream.read().decode(errors="replace")
        if completed is not None and completed():
            print(f"Unity operation completed successfully with noisy exit {result.returncode}; inspect {log}")
        else:
            lines = [line.strip() for line in tail.splitlines() if any(word in line.lower()
                     for word in ("error", "exception", "failed", "crash"))]
            # Unity's trailing LogException stack frame is not the cause.
            causes = [line for line in lines if re.match(
                r"^(?:[\w.]+(?:Exception|Failure)|error(?:\s+\w+)?):", line, re.IGNORECASE)]
            cause = (causes[-1] if causes else lines[-1])[:300] if lines else "no verified completion"
            raise RuntimeError(f"Unity exited {result.returncode}: {cause}; inspect {log}")
    return result.returncode


def completed_method(path, method):
    if not path.is_file():
        return False
    value = json.loads(path.read_text())
    return value.get("method") == method and value.get("status") == "ok"


def execute(editor, target, method, env, log):
    result_path = log.with_suffix(".result.json")
    result_path.unlink(missing_ok=True)
    method_env = dict(env, ZKUBE_BATCH_METHOD=method, ZKUBE_BATCH_RESULT=str(result_path))
    editor_run([editor, "-batchmode", "-nographics", "-quit", "-projectPath", PROJECT,
                "-buildTarget", target, "-executeMethod", "ZKube.Editor.ZKubeBatchCommand.Run"],
               log, method_env, lambda: completed_method(result_path, method))
    if not completed_method(result_path, method):
        raise RuntimeError(f"Unity method {method} has no successful completion; inspect {result_path} and {log}")
    print(f"Unity exec {method}: completed; inspect {result_path}")


def prepare(editor, target, env):
    result_path = OUTPUT / "prepare.result.json"
    result_path.unlink(missing_ok=True)
    method = "ZKube.Editor.ZKubeBuild.Prepare"
    editor_run([editor, "-batchmode", "-nographics", "-projectPath", PROJECT,
                "-buildTarget", target, "-executeMethod", method], OUTPUT / "prepare.log",
               dict(env, ZKUBE_BATCH_METHOD=method, ZKUBE_BATCH_RESULT=str(result_path)),
               lambda: completed_method(result_path, method))
    if not completed_method(result_path, method):
        raise RuntimeError(f"Unity preparation did not complete; inspect {OUTPUT / 'prepare.log'}")


def toolchain():
    global LOCK
    LOCK = json.loads((PROJECT / "toolchain.json").read_text())
    editor = Path(os.environ.get("UNITY_EDITOR", str(Path.home() / "Unity/Hub/Editor" /
                                                   LOCK["editor"] / "Editor/Unity")))
    android = editor.parent / "Data/PlaybackEngines/AndroidPlayer"
    if not editor.is_file():
        raise SystemExit(f"Missing pinned Unity Editor: {editor}")
    ndk = android / "NDK"
    if f'Pkg.Revision = {LOCK["ndk"]}' not in (ndk / "source.properties").read_text():
        raise SystemExit("NDK differs from toolchain.json")
    if f'JAVA_VERSION="{LOCK["jdk"]}"' not in (android / "OpenJDK/release").read_text():
        raise SystemExit("JDK differs from toolchain.json")
    if not (android / "Tools/gradle/lib" / f'gradle-launcher-{LOCK["gradle"]}.jar').is_file():
        raise SystemExit("Gradle differs from toolchain.json")
    template = (android / "Tools/GradleTemplates/baseProjectTemplate.gradle").read_text()
    for plugin in ("application", "library"):
        version = re.search(r"id 'com\.android\." + plugin + r"' version '([^']+)'", template)
        if version is None or version[1] != LOCK["androidGradlePlugin"]:
            raise SystemExit("Unity Android Gradle plugin differs from toolchain.json")
    sdk = android / "SDK"
    for path in [sdk / "build-tools" / LOCK["sdkBuildTools"],
                 sdk / "platforms" / f'android-{LOCK["androidApi"]}']:
        if not path.is_dir():
            raise SystemExit(f"Missing pinned SDK component: {path}")
    return editor, android


def native(android, profile):
    env = dict(os.environ, NO_DNA="1")
    run(["cargo", "build", "--release", "-p", "zkube-core-ffi"], env=env)
    llvm = android / "NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"
    copies = [(ROOT / "target/release/libzkube_core_ffi.so", PROJECT / "Assets/Plugins/x86_64")]
    for abi in abis(LOCK, profile):
        target = abi["rustTarget"]
        prefix = "CARGO_TARGET_" + target.upper().replace("-", "_")
        env[prefix + "_LINKER"] = str(llvm / f'{abi["linkerPrefix"]}{LOCK["androidMinimumApi"]}-clang')
        env[prefix + "_RUSTFLAGS"] = "-C link-arg=-Wl,-z,max-page-size=16384"
        run(["cargo", "build", "--release", "-p", "zkube-core-ffi", "--target", target], env=env)
        copies.append((ROOT / "target" / target / "release/libzkube_core_ffi.so",
                       PROJECT / "Assets/Plugins/Android" / abi["name"]))
    for source, target in copies:
        target.mkdir(parents=True, exist_ok=True)
        destination = target / source.name
        if not destination.exists() or source.read_bytes() != destination.read_bytes():
            shutil.copyfile(source, destination)
    source = ROOT / "assets/pwa-512x512.png"
    directory = PROJECT / "Assets/ZKube/Branding/Generated"
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "AppIcon.png"
    if not destination.exists() or destination.read_bytes() != source.read_bytes():
        shutil.copyfile(source, destination)
    for path in (directory.parent, directory, destination):
        meta = Path(str(path) + ".meta")
        if not meta.exists():
            guid = hashlib.sha256(str(path.relative_to(PROJECT)).encode()).hexdigest()[:32]
            meta.write_text("fileFormatVersion: 2\nguid: " + guid + "\n" +
                            ("folderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n" if path.is_dir() else ""))


def wallet_plugin():
    source = PROJECT / "NativeAndroid/build/outputs/aar/zkube-unity-wallet-release.aar"
    report = json.loads((PROJECT / "NativeAndroid/build/verification.json").read_text())
    if hashlib.sha256(source.read_bytes()).hexdigest() != report["artifactSha256"]:
        raise SystemExit("Native wallet AAR differs from the verified artifact")
    for name, digest in report["sources"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest:
            raise SystemExit("Native wallet source changed after verification: " + name)
    destination = PROJECT / "Assets/Plugins/Android" / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists() or source.read_bytes() != destination.read_bytes():
        shutil.copyfile(source, destination)
    meta = Path(str(destination) + ".meta")
    if not meta.exists():
        guid = hashlib.sha256(str(destination.relative_to(PROJECT)).encode()).hexdigest()[:32]
        meta.write_text("fileFormatVersion: 2\nguid: " + guid + "\n")


def source_snapshot():
    paths = set(subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT).decode().split("\0"))
    # Imported art and native libraries are rebuildable outputs, but are still
    # actual Player inputs and must be bound to the artifact alongside sources.
    paths.update(str(path.relative_to(ROOT)) for path in (PROJECT / "Assets").rglob("*")
                 if path.is_file())
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in sorted(paths) if name and (ROOT / name).is_file()}


def record_artifact(apk, before, started):
    after = source_snapshot()
    changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    inspection = json.loads(apk.with_suffix(".inspection.json").read_text())
    report = {
        "schema": 2, "startedUtc": started, "completedUtc": datetime.now(timezone.utc).isoformat(),
        "identity": inspection["identity"],
        "artifact": apk.name, "artifactSha256": inspection["sha256"],
        "gitHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "toolchain": LOCK, "inputs": before, "inputsChangedDuringBuild": changed,
        "reproducibility": "source and toolchain recorded; byte-identical rebuild not yet assessed",
    }
    # Schema 2 names the artifact independently of its container. Preserve the
    # historical APK keys for money readers; an AAB never masquerades as an APK.
    if inspection["identity"] == "money":
        report.update(apk=apk.name, apkSha256=inspection["sha256"])
    apk.with_suffix(".provenance.json").write_text(json.dumps(report, indent=2) + "\n")
    if changed:
        raise SystemExit("Inputs changed during Android build; rerun after import/configuration settles: " +
                         ", ".join(changed[:20]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["native", "probe", "prepare", "diagnose-art", "test", "android", "exec"])
    parser.add_argument("--test-platform", choices=["EditMode", "PlayMode"], default="EditMode")
    parser.add_argument("--test-filter", default="ZKube")
    parser.add_argument("--identity", choices=["money", "store"], default="money")
    parser.add_argument("--method", help="exec: fully qualified static method, e.g. ZKube.Editor.ZKubeBuild.Probe")
    parser.add_argument("--build-target", choices=["StandaloneLinux64", "Android"], help="exec: Editor build target (default StandaloneLinux64)")
    args = parser.parse_args()
    if args.action == "exec" and not args.method:
        parser.error("exec requires --method ZKube.Editor.<Class>.<Method>")
    if args.method and not re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+", args.method):
        parser.error("--method must be a fully qualified C# method name")
    # Desktop inspection uses desktop imports: this Linux OpenGL driver reports
    # Android ASTC atlases unsupported, so they cannot establish visual parity.
    target = "StandaloneLinux64" if args.action in ("test", "exec") else "Android"
    if args.action == "exec" and args.build_target:
        target = args.build_target
    if args.identity == "store" and target != "Android":
        parser.error("--identity store selects an Android Player build; Editor tests run the shared suite without this option")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    method = {"probe": "ZKubeBuild.Probe", "prepare": "ZKubeBuild.Prepare",
              "diagnose-art": "ZKubeAssetImports.DiagnoseSpriteImport"}.get(args.action, "ZKubeBuild.BuildAndroid")
    # Unity prints its process environment on Gradle failures. Pass only build
    # and desktop paths, so unrelated signer/service credentials cannot enter logs.
    inherited = {"HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "SHELL",
                 "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY",
                 "DBUS_SESSION_BUS_ADDRESS", "GRADLE_USER_HOME", "SSL_CERT_FILE",
                 "SSL_CERT_DIR", "ZKUBE_ANDROID_VERSION_CODE", "ZKUBE_ANDROID_VERSION_NAME"}
    env = {key: value for key, value in os.environ.items() if key in inherited}
    # The pinned sdkmanager's URLConnection calls have no explicit timeout.
    # Bound metadata fetches instead of hanging the Editor lease on a TLS peer.
    env["JAVA_TOOL_OPTIONS"] = ("-Dsun.net.client.defaultConnectTimeout=30000 "
                                "-Dsun.net.client.defaultReadTimeout=30000")
    profile = identity(json.loads((PROJECT / "toolchain.json").read_text()), args.identity)
    stem = "zkube" if args.identity == "money" else "zkube-store"
    apk = OUTPUT / f'{stem}.{profile["format"]}'
    env.update(NO_DNA="1", ZKUBE_UNITY_APK=str(apk),
               ZKUBE_UNITY_IDENTITY=args.identity, ZKUBE_UNITY_PRODUCT_NAME=profile["productName"])
    with editor_lease() as lease_fd:
        generated_idl = PROJECT / "Assets/ZKube/Integration/Generated/solana.json"
        generated_idl.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "tools/chain/idl/solana.json", generated_idl)
        editor, android = toolchain()
        if args.action == "android" and args.identity == "money":
            run(["python3", PROJECT / "NativeAndroid/verify.py"], env=env)
        if args.action in ("prepare", "android", "test"):
            run(["python3", PROJECT / "tools/import_assets.py", "--sync"],
                env=dict(env, **{INHERITED_FD: str(lease_fd)}), pass_fds=(lease_fd,))
        if args.action == "exec":
            log = OUTPUT / f"exec-{args.method.rsplit('.', 1)[-1]}.log"
            execute(editor, target, args.method, env, log)
            return
        native(android, profile)
        if args.action == "android" and args.identity == "money":
            wallet_plugin()
        if args.action == "native":
            return
        if args.action == "test":
            # Tests load generated atlases and fonts too. Prepare those inputs
            # under this same lease instead of relying on a prior Player build.
            prepare(editor, target, env)
            result_path = OUTPUT / f"{args.test_platform.lower()}-tests.xml"
            # A prior successful report cannot satisfy a run that exits before
            # the test runner writes its results (for example, import failure).
            result_path.unlink(missing_ok=True)
            graphics = (["-executeMethod", "ZKube.Editor.ZKubeGraphicsTests.Configure"]
                        if args.test_platform == "PlayMode" else ["-batchmode", "-nographics"])
            def tests_passed():
                if not result_path.is_file():
                    return False
                report = ET.parse(result_path).getroot()
                return (report.get("result") == "Passed" and int(report.get("total", "0")) > 0
                        and report.get("passed") == report.get("total")
                        and not missing_test_filters(report, args.test_filter))

            editor_run([editor, *graphics, "-projectPath", PROJECT,
                 "-buildTarget", target,
                 "-runTests", "-testPlatform", args.test_platform,
                 "-testFilter", args.test_filter, "-testResults", result_path],
                 OUTPUT / f"{args.test_platform.lower()}-tests.log", env, tests_passed)
            if not result_path.is_file():
                raise SystemExit("Unity exited without a test report")
            report = ET.parse(result_path).getroot()
            total = int(report.get("total", "0"))
            passed = int(report.get("passed", "0"))
            if report.get("result") != "Passed" or total == 0 or passed != total:
                raise SystemExit(f"Unity tests incomplete: {passed}/{total} passed; see {result_path}")
            missing = missing_test_filters(report, args.test_filter)
            if missing:
                raise RuntimeError("Unity test filters matched no cases: " + "; ".join(missing) + f"; inspect {result_path}")
            print(f"Unity {args.test_platform}: {passed}/{total} passed ({result_path})")
            return
        if args.action == "android":
            prepare(editor, target, env)
        if args.action == "prepare":
            prepare(editor, target, env)
            return
        started = datetime.now(timezone.utc).isoformat()
        before = source_snapshot() if args.action == "android" else None
        if args.action == "android":
            apk.unlink(missing_ok=True)
            apk.with_suffix(".inspection.json").unlink(missing_ok=True)
            apk.with_suffix(".provenance.json").unlink(missing_ok=True)
        execute(editor, target, f"ZKube.Editor.{method}", env, OUTPUT / f"{args.action}.log")
        if args.action == "android":
            run(["python3", PROJECT / "tools/inspect_android.py", apk,
                 android / "SDK/build-tools" / LOCK["sdkBuildTools"],
                 "--identity", args.identity])
            record_artifact(apk, before, started)


if __name__ == "__main__":
    run_main(main, OUTPUT)
