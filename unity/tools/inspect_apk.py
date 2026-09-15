#!/usr/bin/env python3
"""Verify ARM64 native payloads and 16 KB ELF/ZIP alignment in an Android APK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import zipfile


def elf(data, machine):
    if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', data, 18)[0] != machine:
        raise RuntimeError('Native library has the wrong ELF class, byte order or ABI')
    offset = struct.unpack_from('<Q', data, 32)[0]
    entry_size, count = struct.unpack_from('<HH', data, 54)
    if entry_size < 56 or count == 0 or offset + entry_size * count > len(data):
        raise RuntimeError('ELF program headers are malformed')
    alignments = []
    for i in range(count):
        kind, _, file_offset, virtual, _, size, memory, alignment = struct.unpack_from('<IIQQQQQQ', data, offset + i * entry_size)
        if kind == 1:
            if (size > memory or file_offset + size > len(data) or alignment < 16384 or
                    alignment & (alignment - 1) or file_offset % 16384 != virtual % 16384):
                raise RuntimeError('ELF load segment is not 16 KB compatible')
            alignments.append(alignment)
    if not alignments:
        raise RuntimeError('ELF has no load segments')
    return alignments



def read_member(archive, name):
    try:
        return archive.read(name)
    except KeyError:
        raise RuntimeError("Missing required Android artifact entry: " + name) from None
    except zipfile.BadZipFile as error:
        raise RuntimeError("Malformed Android artifact entry: " + str(error)) from None


def open_archive(path):
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise RuntimeError("Malformed Android ZIP artifact: " + str(error)) from None
    names = archive.namelist()
    if len(names) != len(set(names)):
        archive.close()
        raise RuntimeError("Duplicate Android ZIP artifact entry")
    return archive


def metadata_check(data, mode):
    if mode == "production" and any(token + b"\x00" in data for token in
                                    (b"MoneyEvidenceGraph", b"MoneyEvidenceData", b"MoneyOverviewEvidenceHost",
                                     b"MoneySessionEvidenceGraph", b"MoneySessionEvidenceData",
                                     b"MoneyPlayableEvidenceGraph", b"MoneyPlayableEvidenceData", b"EvidencePointer")):
        raise RuntimeError("Production Player contains offline money evidence")
    if mode == "production" and b"OfflineCampaignStoreDriver\x00" in data:
        raise RuntimeError("Production Player contains the offline purchase driver")
    if mode == "production" and b"StoreStartupDiagnostic\x00" in data:
        raise RuntimeError("Production Player contains the store startup diagnostic")
    evidence = b"BoardEvidenceHarness\x00" in data
    if evidence != (mode == "evidence"):
        raise RuntimeError("Compiled board evidence harness differs from the declared build mode")
    if re.search(rb"ZKube\.[A-Za-z0-9_.]+\.Tests(?:\.dll)?\x00", data):
        raise RuntimeError("Ordinary Player contains managed test assemblies")
    return evidence


def manifest_nodes(dump):
    """Read aapt2's tree, retaining parentage so child attributes cannot satisfy a parent check."""
    nodes, stack = [], []
    for line in dump.splitlines():
        indent = len(line) - len(line.lstrip())
        value = line.strip()
        if value.startswith("E: "):
            while stack and stack[-1][0] >= indent:
                stack.pop()
            node = {"name": value[3:].split()[0], "attributes": {},
                    "parent": stack[-1][1] if stack else None}
            nodes.append(node)
            stack.append((indent, node))
        elif value.startswith("A: ") and stack:
            attribute = re.match(r'A: (?:http://schemas.android.com/apk/res/android:)?([^=(]+)(?:\([^)]*\))?=(.*)', value)
            if attribute:
                raw = attribute[2].split(" (Raw: ", 1)[0]
                stack[-1][1]["attributes"][attribute[1]] = raw.strip('"')
    return nodes


def inspect(apk, android_tools, expected_native, mode):
    toolchain = json.loads((Path(__file__).resolve().parents[1] / "toolchain.json").read_text())
    badging = subprocess.check_output([str(android_tools / "aapt2"), "dump", "badging", str(apk)], text=True)
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
    if package is None or package[1] != "com.zkorp.zkube":
        raise RuntimeError("APK package differs from the money build identity")
    minimum = re.search(r"^minSdkVersion:'(\d+)'", badging, re.M)
    target = re.search(r"^targetSdkVersion:'(\d+)'", badging, re.M)
    if minimum is None or target is None or int(minimum[1]) != toolchain["androidMinimumApi"] or int(target[1]) != toolchain["androidApi"]:
        raise RuntimeError("APK SDK levels differ from the pinned toolchain")
    debuggable = "application-debuggable" in badging.splitlines()
    if debuggable != (mode == "evidence"):
        raise RuntimeError("APK debug flag differs from its declared build mode")
    permissions = re.findall(r"^uses-permission: name='([^']+)'", badging, re.M)
    if "android.permission.INTERNET" not in permissions:
        raise RuntimeError("APK lacks the permission required by the RPC transport")
    if "com.android.vending.BILLING" in permissions:
        raise RuntimeError("Money APK contains the store billing permission")
    manifest = manifest_nodes(subprocess.check_output(
        [str(android_tools / "aapt2"), "dump", "xmltree", "--file", "AndroidManifest.xml", str(apk)], text=True))
    applications = [node for node in manifest if node["name"] == "application"]
    if len(applications) != 1 or applications[0]["attributes"].get("allowBackup") != "false":
        raise RuntimeError("APK must disable backup of installation-bound wallet storage")
    wallet_activity = [node for node in manifest if node["name"] == "activity" and
                       node["attributes"].get("name") == "com.zkorp.zkube.unitywallet.WalletActivity"]
    if len(wallet_activity) != 1 or wallet_activity[0]["attributes"].get("exported") != "false":
        raise RuntimeError("APK wallet trampoline must exist and be non-exported")
    splash = [node for node in manifest if node["name"] == "meta-data" and
              node["parent"] is applications[0] and node["attributes"].get("name") == "unity.splash-enable"]
    if len(splash) != 1 or splash[0]["attributes"].get("value") != "false":
        raise RuntimeError("APK still enables the Unity splash screen")
    java_home = android_tools.parents[2] / "OpenJDK"
    java_env = dict(os.environ, JAVA_HOME=str(java_home),
                    PATH=str(java_home / "bin") + os.pathsep + os.environ.get("PATH", ""))
    certificates = subprocess.check_output([str(android_tools / "apksigner"), "verify", "--print-certs", str(apk)],
                                           text=True, env=java_env)
    certificate_hashes = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)$", certificates, re.M)
    if not certificate_hashes:
        raise RuntimeError("APK has no verified signing certificate")
    source_hash = hashlib.sha256(expected_native.read_bytes()).hexdigest()
    # Android's packaging strips non-runtime symbols from imported plugins.
    # Compare that exact pinned-NDK transformation, not a weakened code-only hash.
    strip_tool = android_tools.parents[2] / "NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"
    scratch = Path(__file__).resolve().parents[2] / "build/unity/apk-inspection"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch) as temp:
        stripped = Path(temp) / "libzkube_core_ffi.so"
        subprocess.run([str(strip_tool), "--strip-unneeded", "-o", str(stripped),
                        str(expected_native)], check=True)
        stripped_hash = hashlib.sha256(stripped.read_bytes()).hexdigest()
    libraries = []
    with open_archive(apk) as archive:
        metadata = read_member(archive, "assets/bin/Data/Managed/Metadata/global-metadata.dat")
        has_evidence = metadata_check(metadata, mode)
        if any(token in metadata for token in (b"Unity.Purchasing.dll\x00", b"UnityEngine.Purchasing\x00",
                                               b"ZKube.Local.Billing.dll\x00", b"ZKube.Local.Billing.Unity.dll\x00")):
            raise RuntimeError("Money APK contains store billing managed code")
        for name in archive.namelist():
            if name.endswith(".dex"):
                dex = read_member(archive, name)
                if any(token in dex for token in (b"Lcom/android/billingclient/", b"Lcom/unity/purchasing/")):
                    raise RuntimeError("Money APK contains native store billing code")
            if name.endswith(("PerformanceTestRunInfo.json", "PerformanceTestRunSettings.json")):
                raise RuntimeError("Ordinary APK contains generated test resources")
        for info in archive.infolist():
            if not info.filename.startswith("lib/") or not info.filename.endswith(".so"):
                continue
            if not info.filename.startswith("lib/arm64-v8a/"):
                raise RuntimeError(f"Unexpected Android architecture: {info.filename}")
            data = read_member(archive, info.filename)
            alignments = elf(data, 183)
            digest = hashlib.sha256(data).hexdigest()
            if info.filename.endswith("/libzkube_core_ffi.so"):
                if digest not in (source_hash, stripped_hash):
                    raise RuntimeError("Packaged Rust library differs from the current build")
            libraries.append({"path": info.filename, "sha256": digest,
                              "loadAlignments": alignments})
    if not any(item["path"].endswith("/libzkube_core_ffi.so") for item in libraries):
        raise RuntimeError("APK does not contain the Rust engine library")
    subprocess.run([str(android_tools / "zipalign"), "-c", "-P", "16", "4", str(apk)], check=True)
    report = {"apk": apk.name, "sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
              "buildMode": mode, "package": package[1], "versionCode": int(package[2]),
              "versionName": package[3], "minimumApi": int(minimum[1]), "targetApi": int(target[1]),
              "debuggable": debuggable, "permissions": permissions,
              "allowBackup": False, "walletActivityExported": False, "unitySplashEnabled": False,
              "compiledBoardEvidenceHarness": has_evidence,
              "signingCertificateSha256": certificate_hashes,
              "releaseSigningAcceptance": "pending; local build signing only",
              "rustSourceLibrarySha256": source_hash,
              "rustStrippedLibrarySha256": stripped_hash,
              "nativeLibraries": libraries, "zipAlignment": 16384,
              "physicalDeviceExecution": "not assessed"}
    apk.with_suffix(".inspection.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Verified {len(libraries)} ARM64 libraries and 16 KB APK alignment: {apk.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("android_build_tools", type=Path)
    parser.add_argument("expected_native", type=Path)
    parser.add_argument("--mode", choices=["evidence", "production"], required=True)
    options = parser.parse_args()
    inspect(options.apk, options.android_build_tools, options.expected_native, options.mode)


if __name__ == "__main__":
    from cli import run_main
    run_main(main)
