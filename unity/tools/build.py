#!/usr/bin/env python3
"""Build the native dependencies and run the pinned Unity project serially."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
from contextlib import contextmanager
import fcntl
import struct
import uuid
import tempfile
import shutil
import subprocess
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

from cli import run_main

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
LOCK = None
OUTPUT = ROOT / "build" / "unity"


def identity(toolchain, name):
    try:
        return _identity(toolchain, name)
    except (KeyError, TypeError) as error:
        raise RuntimeError('Malformed Android identity configuration: ' + str(error)) from None


def _identity(toolchain, name):
    matches = [item for item in toolchain['androidIdentities'] if item['name'] == name]
    if len(matches) != 1 or name not in ('money', 'store'):
        raise RuntimeError('Unknown or duplicate Android identity: ' + name)
    profile = matches[0]
    if (not isinstance(profile['package'], str) or not profile['package'] or
            profile['format'] not in ('apk', 'aab') or not profile['abis'] or
            len(profile['abis']) != len(set(profile['abis']))):
        raise RuntimeError('Malformed Android distribution contract')
    abis(toolchain, profile)
    if not isinstance(profile['productName'], str) or not profile['productName'].strip():
        raise RuntimeError('Android identity requires a display name')
    if profile.get('locks'):
        lock_path = PurePosixPath(profile['locks'])
        if lock_path.is_absolute() or '..' in lock_path.parts:
            raise RuntimeError('Android lock directory must stay within the Unity project')
    if not isinstance(profile['excludedAssemblies'], list):
        raise RuntimeError('Android identity requires excluded assemblies')
    return profile


def abis(toolchain, profile):
    try:
        return _abis(toolchain, profile)
    except (KeyError, TypeError) as error:
        raise RuntimeError('Malformed Android ABI configuration: ' + str(error)) from None


def _abis(toolchain, profile):
    result = []
    for name in profile['abis']:
        matches = [item for item in toolchain['androidAbis'] if item['name'] == name]
        if len(matches) != 1:
            raise RuntimeError('Missing or duplicate Android ABI: ' + name)
        result.append(matches[0])
    return result

LOCK_PATH = Path(__file__).resolve().parents[2] / "build/unity/editor.lock"
INHERITED_FD = "ZKUBE_EDITOR_LEASE_FD"


@contextmanager
def editor_lease():
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    inherited = os.environ.get(INHERITED_FD)
    if inherited is not None:
        fd = int(inherited)
        actual, expected = os.fstat(fd), LOCK_PATH.stat()
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            raise RuntimeError("Inherited Editor lease does not name editor.lock")
        # This uses the parent's open file description. A forged descriptor
        # still has to acquire the real lock; it cannot bypass a running Editor.
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Unity build/test operation is active") from None
        yield fd
        return
    with LOCK_PATH.open("a") as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Unity build/test operation is active") from None
        yield lease.fileno()

SOURCE = ROOT / "assets"
FONTS = PROJECT / "tools/font_sources"
ART = PROJECT / "Assets/ZKube/Art"
GENERATED = ART / "Generated"
RESOURCE = "Resources/ZKube"
GUID_NAMESPACE = uuid.UUID("d72898c9-d549-58e7-aace-58e1d6058843")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def guid(path):
    return uuid.uuid5(GUID_NAMESPACE, path.relative_to(PROJECT).as_posix()).hex


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def theme_catalog():
    return json.loads((SOURCE / "theme-catalog.generated.json").read_text())


def asset_plan():
    catalog = theme_catalog()
    files = {}
    entries = []
    scopes = ["common"] + [theme["id"] for theme in catalog["themes"]]
    references = set(catalog["effects"].values()) | set(catalog["commonImages"].values())
    for theme in catalog["themes"]:
        references.update(theme["images"].values())
        references.update(theme["music"].values())
        references.add(theme["guardianPortrait"])
    for scope in scopes:
        for reference in sorted(value for value in references if value.startswith(f"/assets/{scope}/")):
            source = SOURCE / reference.removeprefix("/assets/")
            if source.is_symlink() or not source.is_file():
                raise RuntimeError(f"Expected regular source asset: {source}")
            local = source.relative_to(SOURCE / scope)
            name = "__".join(local.with_suffix("").parts)
            data = source.read_bytes()
            entry = {"source": source.relative_to(ROOT).as_posix(), "sha256": digest(data),
                     "bytes": len(data), "scope": scope, "name": name}
            if source.suffix == ".png":
                if data[:8] != b"\x89PNG\r\n\x1a\n":
                    raise RuntimeError(f"Not a PNG: {source}")
                width, height = struct.unpack(">II", data[16:24])
                destination = GENERATED / "Sprites" / scope / f"{name}.png"
                entry.update(kind="sprite", width=width, height=height,
                             atlas=f"ZKube/Atlases/{scope}", sprite=name)
            else:
                destination = GENERATED / RESOURCE / "Audio" / scope / f"{name}.mp3"
                entry.update(kind="audio", resource=f"ZKube/Audio/{scope}/{name}",
                             streaming="/musics/" in source.as_posix())
            if destination in files:
                raise RuntimeError(f"Flattened import path collision: {destination}")
            entry.update(asset=destination.relative_to(PROJECT).as_posix(), guid=guid(destination))
            entries.append(entry)
            files[destination] = data
    # Keep the ordinary source lookup before adding byte-identical portrait
    # imports; those copies must not replace the realm's board sprite binding.
    by_source = {"/assets/" + Path(e["source"]).relative_to("assets").as_posix(): e for e in entries}
    catalog["portraits"] = portrait_imports(catalog, by_source, entries, files)
    scopes.append("portraits")
    font_lock = json.loads((FONTS / "provenance.json").read_text())["sha256"]
    font_entries = []
    for relative, expected_hash in font_lock.items():
        source = FONTS / relative
        data = source.read_bytes()
        if digest(data) != expected_hash:
            raise RuntimeError(f"Pinned font/license changed: {relative}")
        destination = GENERATED / "FontSources" / relative
        files[destination] = data
        if source.suffix == ".ttf":
            if data[:4] != b"\x00\x01\x00\x00":
                raise RuntimeError(f"Expected static TrueType font: {relative}")
            count = struct.unpack(">H", data[4:6])[0]
            tags = {data[12 + 16 * i:16 + 16 * i] for i in range(count)}
            if b"fvar" in tags:
                raise RuntimeError(f"Variable font requires an explicit static source: {relative}")
            font_entries.append({"name": source.stem, "sha256": expected_hash,
                "source": source.relative_to(ROOT).as_posix(),
                "asset": destination.relative_to(PROJECT).as_posix(),
                "guid": guid(destination), "resource": f"ZKube/Fonts/{source.stem}",
                "fontAssetGuid": guid(GENERATED / RESOURCE / "Fonts" / f"{source.stem}.asset")})
    files[GENERATED / "FontSources/provenance.json"] = (FONTS / "provenance.json").read_bytes()
    catalog.update(assets=entries, fonts=font_entries,
        atlases=[{"scope": scope, "asset": (GENERATED / RESOURCE / "Atlases" / f"{scope}.spriteatlas").relative_to(PROJECT).as_posix(),
                  "guid": guid(GENERATED / RESOURCE / "Atlases" / f"{scope}.spriteatlas"),
                  "maxTextureSize": 2048 if scope == "portraits" else 4096,
                  "singleTexture": scope == "portraits"} for scope in scopes],
        importPolicy={"schema": 1, "source": "assets", "pixelsPerUnit": 100,
                      "filter": "Bilinear", "mipmaps": False, "readable": False,
                      "androidTextureFormat": "ASTC_6x6", "atlasMaxSize": 4096,
                      "atlasPadding": 4, "allowRotation": False, "tightPacking": False,
                      "includeAtlasInBuild": False,
                      "loading": "Explicit Resources.LoadAsync<SpriteAtlas> per realm; GetSprite by catalog name. Release old realm references before unloading. Audio is separate and music streams locally."})
    # Resolve every live function's asset path against copied bytes; fail missing files.
    for theme in catalog["themes"]:
        theme["sprites"] = [{"name": key, "atlas": by_source[value]["atlas"], "sprite": by_source[value]["sprite"]}
                            for key, value in theme["images"].items()]
        theme["audio"] = [{"context": key, "resource": by_source[value]["resource"]}
                          for key, value in theme["music"].items()]
    catalog["effectResources"] = [{"name": key, "resource": by_source[value]["resource"]}
                                  for key, value in catalog["effects"].items()]
    catalog_path = GENERATED / RESOURCE / "Catalog.json"
    files[catalog_path] = encoded(catalog)
    return files, catalog


def portrait_imports(catalog, by_source, entries, files):
    portraits = []
    for theme in catalog["themes"]:
        realm = theme["realmId"]
        source = by_source.get(theme["guardianPortrait"])
        if source is None or source["kind"] != "sprite" or source["scope"] != theme["id"]:
            raise RuntimeError(f"Guardian portrait must use its canonical existing theme sprite: {realm}")
        name = f"guardian-{realm}"
        destination = GENERATED / "Sprites" / "portraits" / f"{name}.png"
        if destination in files:
            raise RuntimeError(f"Duplicate portrait realm: {realm}")
        # Exact original PNG bytes and provenance; the existing Unity importer
        # performs the deterministic small sprite import, without authored art.
        data = files[PROJECT / source["asset"]]
        entry = dict(source, scope="portraits", name=name, sprite=name,
                     atlas="ZKube/Atlases/portraits", asset=destination.relative_to(PROJECT).as_posix(),
                     guid=guid(destination), maxTextureSize=256)
        entries.append(entry); files[destination] = data
        portraits.append({"realmId": realm, "source": source["source"], "sha256": source["sha256"],
                          "atlas": entry["atlas"], "sprite": name})
    return portraits


def metadata(path, folder=False):
    return (f"fileFormatVersion: 2\nguid: {guid(path)}\n" +
            ("folderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n  userData: generated by unity/tools/build.py\n" if folder else "")).encode()


def verify_meta(path):
    meta = Path(str(path) + ".meta")
    if not meta.is_file() or f"guid: {guid(path)}\n" not in meta.read_text():
        raise RuntimeError(f"Missing or changed generated GUID: {meta}")


def sync_assets():
    files, catalog = asset_plan()
    editor_paths = [PROJECT / atlas['asset'] for atlas in catalog['atlases']]
    editor_paths += [GENERATED / 'Resources' / (font['resource'] + '.asset') for font in catalog['fonts']]
    folders = set()
    for path in [*files, *editor_paths]:
        for parent in path.parents:
            if parent == ART: break
            folders.add(parent)
    for path in sorted(folders):
        path.mkdir(parents=True, exist_ok=True)
        meta = Path(str(path) + '.meta')
        if not meta.exists(): meta.write_bytes(metadata(path, folder=True))
        verify_meta(path)
    for path, content in files.items():
        if not path.exists() or path.read_bytes() != content: path.write_bytes(content)
        meta = Path(str(path) + '.meta')
        if not meta.exists(): meta.write_bytes(metadata(path))
        verify_meta(path)
    for path in editor_paths:
        if path.exists(): verify_meta(path)
    expected = set(files) | set(editor_paths)
    extras = [path.relative_to(GENERATED).as_posix() for path in GENERATED.rglob('*')
              if path.is_file() and path.suffix != '.meta' and path not in expected]
    if extras:
        raise RuntimeError('Unexpected generated files; remove retired imports: ' + ', '.join(extras))
    print(f"Synchronized {len(catalog['assets'])} source assets and {len(catalog['fonts'])} pinned fonts.")


def fixtures(action):
    env = dict(os.environ, NO_DNA='1')
    run(['cargo', 'run', '-p', 'zkube-codegen', '--', action], env=env)
    result = subprocess.run(['cargo', 'run', '--quiet', '-p', 'solana', '--example', 'unity-fixtures'],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, check=True, timeout=180)
    content = result.stdout.decode('utf-8')
    json.loads(content)
    path = ROOT / 'fixtures/program-unity-v1.json'
    if action == 'generate': path.write_text(content)
    elif path.read_text() != content:
        raise RuntimeError('Stale program integration fixture: ' + str(path))
    print('Native and program fixtures: ' + action + ' passed')


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
    installed = set(subprocess.check_output(["rustup", "target", "list", "--installed"], text=True).split())
    missing = {abi["rustTarget"] for abi in LOCK["androidAbis"]} - installed
    if missing:
        raise RuntimeError("Missing Rust Android targets: " + ", ".join(sorted(missing)))
    bundletool = android / "Tools" / f'bundletool-all-{LOCK["bundletool"]}.jar'
    if not bundletool.is_file():
        raise RuntimeError(f"Missing pinned bundletool: {bundletool}")
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


def regenerate_locks(export, android, profile, env):
    java = android / 'OpenJDK'
    command = [java / 'bin/java', '-classpath',
               android / 'Tools/gradle/lib' / f'gradle-launcher-{LOCK["gradle"]}.jar',
               'org.gradle.launcher.GradleMain', '--offline', '--no-daemon', '--console=plain',
               ':launcher:zkubeResolveLockedDependencies', ':unityLibrary:zkubeResolveLockedDependencies', '--write-locks']
    subprocess.run([str(value) for value in command], cwd=export,
                   env=dict(env, JAVA_HOME=str(java), ANDROID_HOME=str(android / 'SDK')), check=True)
    updates = []
    for module in ('launcher', 'unityLibrary'):
        source = export / module / 'gradle.lockfile'
        if not source.is_file(): raise RuntimeError('Gradle produced no lock for ' + module)
        destination = PROJECT / profile['locks'] / module / 'gradle.lockfile'
        updates.append((destination, source.read_bytes()))
    for destination, content in updates:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["test", "android", "exec", "fixtures", "locks"])
    parser.add_argument("--fixture-action", choices=["check", "generate"], default="check")
    parser.add_argument("--test-platform", choices=["EditMode", "PlayMode", "all"], default="all")
    parser.add_argument("--test-filter", default="ZKube")
    parser.add_argument("--identity", choices=["money", "store"], default="money")
    parser.add_argument("--production", action="store_true", help="Android: require an explicit version code and non-debug signing")
    parser.add_argument("--method", help="exec: fully qualified static method, e.g. ZKube.Editor.ZKubeBuild.Probe")
    parser.add_argument("--build-target", choices=["StandaloneLinux64", "Android"], help="exec: Editor build target (default StandaloneLinux64)")
    args = parser.parse_args()
    if args.action == "fixtures":
        fixtures(args.fixture_action)
        return
    if args.action == "locks" and args.identity != "money":
        parser.error("locks applies only to the money identity")
    if args.production and args.action != "android":
        parser.error("--production requires android")
    if args.production:
        version = os.environ.get("ZKUBE_ANDROID_VERSION_CODE", "")
        if not version.isdecimal() or int(version) < 1:
            raise RuntimeError("Production requires an explicit positive ZKUBE_ANDROID_VERSION_CODE")
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
               ZKUBE_UNITY_IDENTITY=args.identity,
               ZKUBE_ANDROID_PRODUCTION="1" if args.production else "0")
    with editor_lease():
        generated_idl = PROJECT / "Assets/ZKube/Integration/Generated/solana.json"
        generated_idl.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "tools/chain/idl/solana.json", generated_idl)
        editor, android = toolchain()
        if args.action in ("android", "locks") and args.identity == "money":
            run(["python3", PROJECT / "NativeAndroid/verify.py"], env=env)
        if args.action in ("android", "test", "locks"):
            sync_assets()
        if args.action == "exec":
            log = OUTPUT / f"exec-{args.method.rsplit('.', 1)[-1]}.log"
            execute(editor, target, args.method, env, log)
            return
        native(android, profile)
        if args.action in ("android", "locks") and args.identity == "money":
            wallet_plugin()
        if args.action == "test":
            # Tests load generated atlases and fonts too. Prepare those inputs
            # under this same lease instead of relying on a prior Player build.
            prepare(editor, target, env)
            platforms = ('EditMode', 'PlayMode') if args.test_platform == 'all' else (args.test_platform,)
            for platform in platforms:
                result_path = OUTPUT / f"{platform.lower()}-tests.xml"
                # A prior successful report cannot satisfy a run that exits before
                # the test runner writes its results (for example, import failure).
                result_path.unlink(missing_ok=True)
                graphics = (["-executeMethod", "ZKube.Editor.ZKubeGraphicsTests.Configure"]
                            if platform == "PlayMode" else ["-batchmode", "-nographics"])
                def tests_passed():
                    if not result_path.is_file():
                        return False
                    report = ET.parse(result_path).getroot()
                    return (report.get("result") == "Passed" and int(report.get("total", "0")) > 0
                            and report.get("passed") == report.get("total")
                            and not missing_test_filters(report, args.test_filter))

                editor_run([editor, *graphics, "-projectPath", PROJECT,
                     "-buildTarget", target,
                     "-runTests", "-testPlatform", platform,
                     "-testFilter", args.test_filter, "-testResults", result_path],
                     OUTPUT / f"{platform.lower()}-tests.log", env, tests_passed)
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
                print(f"Unity {platform}: {passed}/{total} passed ({result_path})")
            return
        if args.action in ("android", "locks"):
            prepare(editor, target, env)
        if args.action == "locks":
            with tempfile.TemporaryDirectory(prefix="lock-export-", dir=OUTPUT) as temporary:
                export = Path(temporary)
                execute(editor, target, "ZKube.Editor.ZKubeBuild.BuildAndroid",
                        dict(env, ZKUBE_EXPORT_LOCKS="1", ZKUBE_UNITY_APK=str(export)), OUTPUT / "locks.log")
                regenerate_locks(export, android, profile, env)
            print("Money application dependency locks regenerated")
            return
        started = datetime.now(timezone.utc).isoformat()
        before = source_snapshot() if args.action == "android" else None
        if args.action == "android":
            apk.unlink(missing_ok=True)
            apk.with_suffix(".inspection.json").unlink(missing_ok=True)
            apk.with_suffix(".provenance.json").unlink(missing_ok=True)
        execute(editor, target, "ZKube.Editor.ZKubeBuild.BuildAndroid", env, OUTPUT / f"{args.action}.log")
        if args.action == "android":
            run(["python3", PROJECT / "tools/inspect_android.py", apk,
                 android / "SDK/build-tools" / LOCK["sdkBuildTools"],
                 "--identity", args.identity,
                 *(["--production-version-code", env["ZKUBE_ANDROID_VERSION_CODE"]] if args.production else [])])
            record_artifact(apk, before, started)


if __name__ == "__main__":
    run_main(main, OUTPUT)
