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
from android_identity import identity, abis
import inspect_apk
from inspect_apk import elf, open_archive, read_member

PROJECT = Path(__file__).resolve().parents[1]
ANDROID = '{http://schemas.android.com/apk/res/android}'
MONEY_ASSEMBLIES = ('ZKube.Integration', 'ZKube.Client', 'ZKube.Planning', 'ZKube.Transport',
                    'ZKube.Execution', 'ZKube.RunReconciliation', 'ZKube.AndroidWallet',
                    'ZKube.SolanaPrimitives', 'ZKube.MoneyPresentation', 'ZKube.MoneyApp',
                    'ZKube.MoneyStartup', 'ZKube.MoneyEvidence', 'ZKube.MoneyEvidenceHost', 'Chaos.NaCl')
MONEY_DEX = (b'Lcom/solana/', b'Lcom/solanamobile/', b'Lcom/zkorp/zkube/unitywallet/')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def metadata_check(data, mode):
    evidence = inspect_apk.metadata_check(data, mode)
    for name in MONEY_ASSEMBLIES:
        if name.encode() + b'\x00' in data or name.encode() + b'.dll\x00' in data:
            raise RuntimeError('Store contains money assembly: ' + name)
    for token in (b'WalletClient\x00', b'SolanaRpcTransport\x00', b'Solana.Unity.Wallet\x00',
                  b'ZKube.Integration\x00', b'RunBoardActionProvider\x00', b'Chaos.NaCl\x00'):
        if token in data:
            raise RuntimeError('Store contains a Solana/wallet managed type')
    return evidence


def store_payload(path, prefix, selected_abis, native_hashes, mode):
    libraries = []
    with open_archive(path) as archive:
        names = archive.namelist()
        metadata_check(read_member(archive, prefix + 'assets/bin/Data/Managed/Metadata/global-metadata.dat'), mode)
        for name in names:
            if name.endswith(('PerformanceTestRunInfo.json', 'PerformanceTestRunSettings.json', '.aar')):
                raise RuntimeError('Player includes test metadata or an unprocessed Android archive')
            if name.endswith('.dll') and Path(name).stem in MONEY_ASSEMBLIES:
                raise RuntimeError('Store includes a managed wallet dependency')
            if name.endswith('.dex'):
                data = read_member(archive, name)
                if any(token in data for token in MONEY_DEX):
                    raise RuntimeError('Store DEX contains Solana/wallet code')
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


def store_manifest(xml, profile, toolchain, mode):
    root = ET.fromstring(xml)
    if root.tag != 'manifest' or root.get('package') != profile['package']:
        raise RuntimeError('AAB has the wrong package identity')
    sdk = root.findall('uses-sdk')
    if len(sdk) != 1 or sdk[0].get(ANDROID + 'minSdkVersion') != str(toolchain['androidMinimumApi']) or sdk[0].get(ANDROID + 'targetSdkVersion') != str(toolchain['androidApi']):
        raise RuntimeError('AAB SDK levels differ from the pinned toolchain')
    apps = root.findall('application')
    if len(apps) != 1:
        raise RuntimeError('AAB must contain one application')
    app = apps[0]
    if app.get(ANDROID + 'allowBackup') != 'false' or (app.get(ANDROID + 'debuggable', 'false') == 'true') != (mode == 'evidence'):
        raise RuntimeError('AAB backup/debug settings differ from build policy')
    splash = [node for node in app.findall('meta-data') if node.get(ANDROID + 'name') == 'unity.splash-enable']
    if len(splash) != 1 or splash[0].get(ANDROID + 'value') != 'false':
        raise RuntimeError('AAB still enables the Unity splash screen')
    for node in root.iter():
        if any(any(term in value.lower() for term in ('com.solana', 'unitywallet', 'solana-wallet', 'mobilewalletadapter'))
               for value in node.attrib.values()):
            raise RuntimeError('AAB manifest contains a Solana/wallet component or intent')
    return {'package': profile['package'], 'versionCode': int(root.get(ANDROID + 'versionCode')),
            'versionName': root.get(ANDROID + 'versionName'), 'debuggable': mode == 'evidence',
            'minimumApi': toolchain['androidMinimumApi'], 'targetApi': toolchain['androidApi']}


def inspect(artifact, android_tools, name, mode):
    toolchain = json.loads((PROJECT / 'toolchain.json').read_text())
    profile = identity(toolchain, name)
    if artifact.suffix != '.' + profile['format']:
        raise RuntimeError('Artifact suffix does not match its identity')
    if name == 'money':
        inspect_apk.inspect(artifact, android_tools,
                            PROJECT / 'Assets/Plugins/Android/arm64-v8a/libzkube_core_ffi.so', mode)
        destination = artifact.with_suffix('.inspection.json')
        report = json.loads(destination.read_text())
        report.update(identity=name, format='apk')
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
        manifest = store_manifest(manifest_xml, profile, toolchain, mode)
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
        hashes = {}
        for abi in selected:
            source = PROJECT / 'Assets/Plugins/Android' / abi / 'libzkube_core_ffi.so'
            stripped = temp / (abi + '.so')
            subprocess.run([str(android / 'NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip'),
                            '--strip-unneeded', '-o', str(stripped), str(source)], check=True)
            hashes[abi] = dict(source=sha(source.read_bytes()), stripped=sha(stripped.read_bytes()))
        libraries = store_payload(artifact, 'base/', selected, hashes, mode)
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
        apk_libraries = store_payload(apk, '', selected, hashes, mode)
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
                      format='aab', buildMode=mode, rustLibraryHashes=hashes, nativeLibraries=libraries,
                      signingCertificateSha256=[sha(ssl.PEM_cert_to_DER_cert(value)) for value in certificates],
                      bundletoolVersion=toolchain['bundletool'], bundletoolSha256=sha(bundletool.read_bytes()),
                      generatedUniversalApk=retained_apk.name,
                      generatedUniversalApkSha256=sha(apk.read_bytes()), generatedApkZipAlignment=16384,
                      generatedApkSigningCertificateSha256=certificate_hashes[0].lower(),
                      generatedApkSigning='disposable local inspection key; updates across builds require reinstall',
                      walletCode='absent in inspected managed metadata, DEX, manifest and packaged files',
                      releaseSigningAcceptance='pending; local AAB signing only',
                      deliveryEvidence='local universal APK; Play-generated ABI splits not assessed',
                      physicalDeviceExecution='not assessed')
    artifact.with_suffix('.inspection.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Verified store AAB and local universal APK: both ABIs, native hashes, 16 KB alignment, wallet absence')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('android_build_tools', type=Path)
    parser.add_argument('--identity', choices=['money', 'store'], required=True)
    parser.add_argument('--mode', choices=['evidence', 'production'], required=True)
    args = parser.parse_args()
    inspect(args.artifact.resolve(), args.android_build_tools.resolve(), args.identity, args.mode)


if __name__ == '__main__':
    from cli import run_main
    run_main(main)
