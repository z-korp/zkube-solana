#!/usr/bin/env python3
"""Inspect the selected Android artifact and its exact native build inputs.

AAB ZIP offsets are not install alignment. For store, inspect bundletool's local
universal APK too. Its temporary inspection certificate is not an upload or app
signing key. Google Play delivery and physical-device execution remain separate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from build import identity, abis

PROJECT = Path(__file__).resolve().parents[1]
ANDROID = '{http://schemas.android.com/apk/res/android}'
MONEY_ASSEMBLIES = tuple(identity(json.loads((PROJECT / 'toolchain.json').read_text()), 'store')['excludedAssemblies'])
MONEY_DEX = (b'Lcom/solana/', b'Lcom/solanamobile/', b'Lcom/zkorp/zkube/unitywallet/')


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


def common_metadata_check(data):
    if any(token + b"\x00" in data for token in
           (b"BoardHarness", b"TestBoardPointer", b"BoardEvidenceHarness", b"BoardEvidenceData",
            b"MoneyEvidenceGraph", b"MoneyEvidenceData", b"MoneyOverviewEvidenceHost",
            b"MoneySessionEvidenceGraph", b"MoneySessionEvidenceData", b"MoneyPlayableEvidenceGraph",
            b"MoneyPlayableEvidenceData", b"EvidencePointer", b"OfflineCampaignStoreDriver", b"StoreStartupDiagnostic")):
        raise RuntimeError("Player contains a test driver or retired diagnostic")
    if re.search(rb"ZKube\.[A-Za-z0-9_.]+\.(?:Tests|PlayTests)(?:\.dll)?\x00", data):
        raise RuntimeError("Player contains managed test assemblies")


def money_metadata_check(data):
    common_metadata_check(data)
    for name in identity(json.loads((PROJECT / 'toolchain.json').read_text()), 'money')['excludedAssemblies']:
        if name.encode() + b'\x00' in data or name.encode() + b'.dll\x00' in data:
            raise RuntimeError('Money contains store assembly: ' + name)
    for token in (b"StoreRunClient", b"StoreCampaignPolicy"):
        if token + b"\x00" in data:
            raise RuntimeError("Money player contains the store Daily client or policy")


def display_name_check(badging, expected):
    labels = re.findall(r"^application-label(?:-[^:]+)?:'([^']*)'$", badging, re.M)
    if not re.search(r"^application-label:'", badging, re.M) or not labels or any(label != expected for label in labels):
        raise RuntimeError("Android display name differs from the build identity")
    return expected


def production_check(report, version_code):
    if version_code is not None:
        if version_code < 1 or report['versionCode'] != version_code:
            raise RuntimeError('Production version code is missing or differs from the explicit build input')
        if report['debugSigned']:
            raise RuntimeError('Production package is debug-signed')
    report['distribution'] = 'production-candidate' if version_code is not None else 'local-validation'


def debug_certificate(subject):
    return bool(re.search(r'\bCN\s*=\s*(?:Android|Unity) Debug\b', subject, re.I))


def product_name_check(data, expected):
    encoded = expected.encode('utf8')
    if struct.pack('<I', len(encoded)) + encoded not in data:
        raise RuntimeError("Unity product name differs from the build identity")




def apk_manifest(apk, android_tools):
    dump = subprocess.check_output([str(android_tools / 'aapt2'), 'dump', 'xmltree',
                                   '--file', 'AndroidManifest.xml', str(apk)], text=True)
    root, stack = None, []
    for line in dump.splitlines():
        indent, value = len(line) - len(line.lstrip()), line.strip()
        if value.startswith('E: '):
            while stack and stack[-1][0] >= indent: stack.pop()
            node = ET.Element(value[3:].split()[0])
            if stack: stack[-1][1].append(node)
            elif root is None: root = node
            else: raise RuntimeError('Android manifest has multiple roots')
            stack.append((indent, node))
        elif value.startswith('A: ') and stack:
            match = re.match(r'A: (http://schemas.android.com/apk/res/android:)?([^=(]+)(?:\([^)]*\))?=(.*)', value)
            if match:
                name = (ANDROID if match[1] else '') + match[2]
                stack[-1][1].set(name, match[3].split(' (Raw: ', 1)[0].strip('"'))
    if root is None: raise RuntimeError('Missing Android manifest')
    return root


def sha(data):
    return hashlib.sha256(data).hexdigest()


def metadata_check(data):
    common_metadata_check(data)
    for name in MONEY_ASSEMBLIES:
        if name.encode() + b'\x00' in data or name.encode() + b'.dll\x00' in data:
            raise RuntimeError('Store contains money assembly: ' + name)
    for token in (b'WalletClient\x00', b'SolanaRpcTransport\x00', b'Solana.Unity.Wallet\x00',
                  b'ZKube.Integration\x00', b'RunBoardActionProvider\x00', b'Chaos.NaCl\x00'):
        if token in data:
            raise RuntimeError('Store contains a Solana/wallet managed type')


def payload(path, prefix, selected_abis, native_hashes, profile):
    libraries = []
    with open_archive(path) as archive:
        names = archive.namelist()
        data = read_member(archive, prefix + 'assets/bin/Data/Managed/Metadata/global-metadata.dat')
        (metadata_check if profile['name'] == 'store' else money_metadata_check)(data)
        if profile['name'] == 'money' and any(token in data for token in (b'Unity.Purchasing.dll\x00', b'UnityEngine.Purchasing\x00')):
            raise RuntimeError('Money contains billing managed code')
        for name in names:
            if name.endswith(('PerformanceTestRunInfo.json', 'PerformanceTestRunSettings.json', '.aar')):
                raise RuntimeError('Player includes test metadata or an unprocessed Android archive')
            if name.endswith('.dll') and Path(name).stem in profile['excludedAssemblies']:
                raise RuntimeError('Store includes a managed wallet dependency')
            if name.endswith('.dex'):
                data = read_member(archive, name)
                if any(token in data for token in (MONEY_DEX if profile['name'] == 'store' else (b'Lcom/android/billingclient/', b'Lcom/unity/purchasing/'))):
                    raise RuntimeError('DEX contains code from the other identity')
            if not name.endswith('.so'):
                continue
            match = re.fullmatch(re.escape(prefix) + r'lib/([^/]+)/([^/]+\.so)', name)
            if match is None or match[1] not in selected_abis:
                raise RuntimeError('Unexpected native module or ABI: ' + name)
            data = read_member(archive, name)
            alignments = elf(data, selected_abis[match[1]]['elfMachine'])
            digest = sha(data)
            if match[2] == 'libzkube_core_ffi.so' and digest not in native_hashes[match[1]].values():
                raise RuntimeError('Packaged Rust library differs from selected ABI build input')
            libraries.append(dict(path=name, abi=match[1], sha256=digest, loadAlignments=alignments))
        for abi in selected_abis:
            for library in ('libzkube_core_ffi.so', 'libil2cpp.so', 'libunity.so'):
                if prefix + f'lib/{abi}/{library}' not in names:
                    raise RuntimeError('Missing required native payload: ' + abi + '/' + library)
    return libraries


def manifest_check(root, profile, toolchain):
    if root.tag != 'manifest' or root.get('package') != profile['package']:
        raise RuntimeError('Android artifact has the wrong package identity')
    sdk = root.findall('uses-sdk')
    if len(sdk) != 1 or sdk[0].get(ANDROID + 'minSdkVersion') != str(toolchain['androidMinimumApi']) or sdk[0].get(ANDROID + 'targetSdkVersion') != str(toolchain['androidApi']):
        raise RuntimeError('Android artifact SDK levels differ from the pinned toolchain')
    apps = root.findall('application')
    if len(apps) != 1:
        raise RuntimeError('Android artifact must contain one application')
    app = apps[0]
    if app.get(ANDROID + 'label') != profile['productName']:
        raise RuntimeError('Android artifact display name differs from the build identity')
    if app.get(ANDROID + 'allowBackup') != 'false' or app.get(ANDROID + 'debuggable', 'false') == 'true':
        raise RuntimeError('Android artifact backup/debug settings differ from build policy')
    splash = [node for node in app.findall('meta-data') if node.get(ANDROID + 'name') == 'unity.splash-enable']
    if len(splash) != 1 or splash[0].get(ANDROID + 'value') != 'false':
        raise RuntimeError('Android artifact still enables the Unity splash screen')
    permissions = [node.get(ANDROID + 'name') for node in root.findall('uses-permission')]
    if 'android.permission.INTERNET' not in permissions:
        raise RuntimeError('Android artifact lacks internet permission')
    if profile['name'] == 'store':
        for node in root.iter():
            if any(any(term in value.lower() for term in ('com.solana', 'unitywallet', 'solana-wallet', 'mobilewalletadapter'))
                   for value in node.attrib.values()):
                raise RuntimeError('Store manifest contains a Solana/wallet component or intent')
    else:
        if 'com.android.vending.BILLING' in permissions:
            raise RuntimeError('Money manifest contains billing permission')
        wallet = [node for node in app.findall('activity')
                  if node.get(ANDROID + 'name') == 'com.zkorp.zkube.unitywallet.WalletActivity']
        if len(wallet) != 1 or wallet[0].get(ANDROID + 'exported') != 'false':
            raise RuntimeError('Wallet trampoline must exist and be non-exported')
    return {'package': profile['package'], 'displayName': profile['productName'], 'versionCode': int(root.get(ANDROID + 'versionCode')),
            'versionName': root.get(ANDROID + 'versionName'), 'debuggable': False, 'allowBackup': False, 'unitySplashEnabled': False, 'permissions': permissions,
            'minimumApi': toolchain['androidMinimumApi'], 'targetApi': toolchain['androidApi']}



def inspect_money(apk, android_tools):
    toolchain = json.loads((Path(__file__).resolve().parents[1] / "toolchain.json").read_text())
    profile = identity(toolchain, 'money')
    manifest = manifest_check(apk_manifest(apk, android_tools), profile, toolchain)
    badging = subprocess.check_output([str(android_tools / 'aapt2'), 'dump', 'badging', str(apk)], text=True)
    display_name = display_name_check(badging, profile['productName'])
    java_home = android_tools.parents[2] / "OpenJDK"
    java_env = dict(os.environ, JAVA_HOME=str(java_home),
                    PATH=str(java_home / "bin") + os.pathsep + os.environ.get("PATH", ""))
    certificates = subprocess.check_output([str(android_tools / "apksigner"), "verify", "--print-certs", str(apk)],
                                           text=True, env=java_env)
    certificate_hashes = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)$", certificates, re.M)
    if not certificate_hashes:
        raise RuntimeError("APK has no verified signing certificate")
    profile_abis = {abi['name']: abi for abi in abis(toolchain, profile)}
    hashes = native_hashes(android_tools.parents[2], profile_abis)
    libraries = payload(apk, '', profile_abis, hashes, profile)
    with open_archive(apk) as archive:
        product_name_check(read_member(archive, 'assets/bin/Data/globalgamemanagers'), display_name)
    subprocess.run([str(android_tools / "zipalign"), "-c", "-P", "16", "4", str(apk)], check=True)
    report = {**manifest, "apk": apk.name, "sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
              "allowBackup": False, "walletActivityExported": False, "unitySplashEnabled": False,
              "signingCertificateSha256": certificate_hashes,
              "debugSigned": debug_certificate(certificates),
              "releaseSigningAcceptance": "pending; local build signing only",
              "rustSourceLibrarySha256": hashes["arm64-v8a"]["source"],
              "rustStrippedLibrarySha256": hashes["arm64-v8a"]["stripped"],
              "nativeLibraries": libraries, "zipAlignment": 16384,
              "physicalDeviceExecution": "not assessed"}
    return report


def native_hashes(android, selected):
    scratch = PROJECT.parent / 'build/unity/native-inspection'
    scratch.mkdir(parents=True, exist_ok=True)
    hashes = {}
    with tempfile.TemporaryDirectory(dir=scratch) as name:
        for abi in selected:
            source = PROJECT / 'Assets/Plugins/Android' / abi / 'libzkube_core_ffi.so'
            stripped = Path(name) / (abi + '.so')
            subprocess.run([str(android / 'NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip'),
                            '--strip-unneeded', '-o', str(stripped), str(source)], check=True)
            hashes[abi] = dict(source=sha(source.read_bytes()), stripped=sha(stripped.read_bytes()))
    return hashes


def inspect(artifact, android_tools, name, production_version_code=None):
    toolchain = json.loads((PROJECT / 'toolchain.json').read_text())
    profile = identity(toolchain, name)
    if artifact.suffix != '.' + profile['format']:
        raise RuntimeError('Artifact suffix does not match its identity')
    if name == 'money':
        report = inspect_money(artifact, android_tools)
        destination = artifact.with_suffix('.inspection.json')
        report.update(identity=name, format='apk')
        production_check(report, production_version_code)
        destination.write_text(json.dumps(report, indent=2) + '\n')
        return
    android = android_tools.parents[2]
    java = android / 'OpenJDK/bin/java'
    bundletool = android / 'Tools' / ('bundletool-all-' + toolchain['bundletool'] + '.jar')
    command = [str(java), '-jar', str(bundletool)]
    selected = {abi['name']: abi for abi in abis(toolchain, profile)}
    scratch = PROJECT.parent / 'build/unity/aab-inspection'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch) as temp_name:
        temp = Path(temp_name)
        subprocess.run(command + ['validate', '--bundle=' + str(artifact)], check=True)
        manifest_xml = subprocess.check_output(command + ['dump', 'manifest', '--bundle=' + str(artifact), '--module=base'], text=True)
        manifest = manifest_check(ET.fromstring(manifest_xml), profile, toolchain)
        # The offline local AAB must be signed, but this does not approve its key
        # for Play. Self-signed-chain warning (bit 4) is permitted for local proof.
        verification = subprocess.run([str(android / 'OpenJDK/bin/jarsigner'), '-J-Duser.language=en',
                                       '-verify', '-strict', str(artifact)], capture_output=True, text=True)
        if verification.returncode not in (0, 4) or 'jar verified' not in verification.stdout.lower():
            raise RuntimeError('AAB signature verification failed: ' + verification.stdout[-1000:])
        cert = subprocess.check_output([str(android / 'OpenJDK/bin/keytool'), '-printcert', '-jarfile', str(artifact), '-rfc'], text=True)
        certificates = re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', cert, re.S)
        if not certificates:
            raise RuntimeError('AAB has no signing certificate')
        subjects = subprocess.check_output([str(android / 'OpenJDK/bin/keytool'), '-J-Duser.language=en',
                                           '-printcert', '-jarfile', str(artifact)], text=True)
        debug_signed = debug_certificate(subjects)
        production_check(dict(manifest, debugSigned=debug_signed), production_version_code)
        hashes = native_hashes(android, selected)
        libraries = payload(artifact, 'base/', selected, hashes, profile)
        with open_archive(artifact) as archive:
            product_name_check(read_member(archive, 'base/assets/bin/Data/globalgamemanagers'), profile['productName'])
        # Never implicitly read/write ~/.android/debug.keystore. This disposable
        # key signs only the retained local inspection APK; delete the key here.
        keystore = temp / 'inspection.p12'
        subprocess.run([str(android / 'OpenJDK/bin/keytool'), '-genkeypair', '-keystore', str(keystore),
                        '-storetype', 'PKCS12', '-storepass', 'inspection-only', '-keypass', 'inspection-only',
                        '-alias', 'inspection', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '1',
                        '-dname', 'CN=Offline artifact inspection', '-noprompt'], check=True, capture_output=True)
        apks = temp / 'inspection.apks'
        subprocess.run(command + ['build-apks', '--bundle=' + str(artifact), '--output=' + str(apks),
                                  '--mode=universal', '--ks=' + str(keystore), '--ks-key-alias=inspection',
                                  '--ks-pass=pass:inspection-only', '--key-pass=pass:inspection-only'], check=True)
        apk = temp / 'universal.apk'
        with open_archive(apks) as archive:
            apk.write_bytes(read_member(archive, 'universal.apk'))
        apk_libraries = payload(apk, '', selected, hashes, profile)
        manifest_check(apk_manifest(apk, android_tools), profile, toolchain)
        badging = subprocess.check_output([str(android_tools / 'aapt2'), 'dump', 'badging', str(apk)], text=True)
        display_name_check(badging, profile['productName'])
        with open_archive(apk) as archive:
            product_name_check(read_member(archive, 'assets/bin/Data/globalgamemanagers'), profile['productName'])
        if {(x['abi'], Path(x['path']).name, x['sha256']) for x in libraries} != {
                (x['abi'], Path(x['path']).name, x['sha256']) for x in apk_libraries}:
            raise RuntimeError('Bundletool changed the native payload')
        subprocess.run([str(android_tools / 'zipalign'), '-c', '-P', '16', '4', str(apk)], check=True)
        apk_certificate = subprocess.check_output([str(android_tools / 'apksigner'),
            'verify', '--print-certs', str(apk)], text=True,
            env=dict(os.environ, JAVA_HOME=str(android / 'OpenJDK')))
        certificate_hashes = re.findall(r'certificate SHA-256 digest: ([0-9a-fA-F]{64})', apk_certificate)
        if len(certificate_hashes) != 1:
            raise RuntimeError('Derived APK must have one verified inspection signer')
        retained_apk = artifact.with_suffix('.universal.apk')
        shutil.copyfile(apk, retained_apk)
        report = dict(manifest, artifact=artifact.name, sha256=sha(artifact.read_bytes()), identity=name,
                      format='aab', rustLibraryHashes=hashes, nativeLibraries=libraries,
                      signingCertificateSha256=[sha(ssl.PEM_cert_to_DER_cert(value)) for value in certificates],
                      debugSigned=debug_signed,
                      bundletoolVersion=toolchain['bundletool'], bundletoolSha256=sha(bundletool.read_bytes()),
                      generatedUniversalApk=retained_apk.name,
                      generatedUniversalApkSha256=sha(apk.read_bytes()), generatedApkZipAlignment=16384,
                      generatedApkSigningCertificateSha256=certificate_hashes[0].lower(),
                      generatedApkSigning='disposable local inspection key; updates across builds require reinstall',
                      walletCode='absent in inspected managed metadata, DEX, manifest and packaged files',
                      releaseSigningAcceptance='pending; local AAB signing only',
                      deliveryEvidence='local universal APK; Play-generated ABI splits not assessed',
                      physicalDeviceExecution='not assessed')
    production_check(report, production_version_code)
    artifact.with_suffix('.inspection.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Verified store AAB and local universal APK: both ABIs, native hashes, 16 KB alignment, wallet absence')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('android_build_tools', type=Path)
    parser.add_argument('--identity', choices=['money', 'store'], required=True)
    parser.add_argument('--production-version-code', type=int)
    args = parser.parse_args()
    inspect(args.artifact.resolve(), args.android_build_tools.resolve(), args.identity, args.production_version_code)


if __name__ == '__main__':
    from cli import run_main
    run_main(main)
