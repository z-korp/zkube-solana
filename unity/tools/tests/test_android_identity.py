#!/usr/bin/env python3
"""Static/pure checks only; never starts Unity, Gradle, native builds or Java."""
import copy
import io
import json
from pathlib import Path
import struct
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'unity/tools'))
from cli import run_main
from android_identity import identity, abis
from inspect_android import elf, metadata_check, store_payload, store_manifest, MONEY_ASSEMBLIES
from inspect_apk import open_archive, read_member


def native(machine=183, alignment=16384):
    value = bytearray(120)
    value[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', value, 18, machine)
    struct.pack_into('<Q', value, 32, 64)
    struct.pack_into('<HH', value, 54, 56, 1)
    struct.pack_into('<IIQQQQQQ', value, 64, 1, 5, 0, 0, 0, len(value), len(value), alignment)
    return bytes(value)


class StaticTests(unittest.TestCase):
    def setUp(self):
        self.toolchain = json.loads((ROOT / 'unity/toolchain.json').read_text())

    def test_profiles_preserve_money_and_add_two_abi_store(self):
        money = identity(self.toolchain, 'money')
        store = identity(self.toolchain, 'store')
        self.assertEqual(('com.zkorp.zkube', 'apk', ['arm64-v8a']), (money['package'], money['format'], money['abis']))
        self.assertEqual(['aarch64-linux-android', 'x86_64-linux-android'], [a['rustTarget'] for a in abis(self.toolchain, store)])
        self.assertNotEqual(money['locks'], store['locks'])

    def test_profile_rejects_unknown_duplicate_and_cross_identity_locks(self):
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'ios')
        self.toolchain['androidIdentities'].append(copy.deepcopy(self.toolchain['androidIdentities'][0]))
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'money')
        self.toolchain['androidIdentities'].pop()
        self.toolchain['androidIdentities'][1]['locks'] = self.toolchain['androidIdentities'][0]['locks']
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'store')

    def test_missing_profile_field_is_expected_cli_failure(self):
        from contextlib import redirect_stdout
        del self.toolchain['androidIdentities'][1]['package']
        output = io.StringIO()
        with redirect_stdout(output), self.assertRaises(SystemExit) as result:
            run_main(lambda: identity(self.toolchain, 'store'))
        self.assertEqual(1, result.exception.code)
        self.assertIn('Malformed Android identity configuration', output.getvalue())
        self.assertNotIn('Traceback', output.getvalue())

    def test_profile_rejects_store_abi_loss_and_lock_escape(self):
        self.toolchain['androidIdentities'][1]['abis'] = ['arm64-v8a']
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'store')
        self.toolchain['androidIdentities'][1]['abis'].append('x86_64')
        self.toolchain['androidIdentities'][1]['locks'] = '../money-locks'
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'store')

    def test_elf_both_abis_and_alignment(self):
        for machine in (183, 62):
            self.assertEqual([16384], elf(native(machine), machine))
            with self.assertRaises(RuntimeError): elf(native(machine, 4096), machine)
            with self.assertRaises(RuntimeError): elf(native(machine), 3)

    def test_elf_rejects_truncation_and_incongruent_segment(self):
        with self.assertRaises(RuntimeError): elf(native()[:119], 183)
        value = bytearray(native())
        struct.pack_into('<Q', value, 80, 1)
        with self.assertRaises(RuntimeError): elf(value, 183)

    def test_metadata_rejects_every_money_assembly_and_tests(self):
        self.assertFalse(metadata_check(b'ZKube.Core.dll\x00ZKube.Presentation.dll\x00'))
        for name in MONEY_ASSEMBLIES:
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                metadata_check(name.encode() + b'.dll\x00')
        with self.assertRaises(RuntimeError): metadata_check(b'ZKube.Core.Tests.dll\x00')

    def test_metadata_rejects_test_drivers_and_retired_diagnostics(self):
        self.assertIsNone(metadata_check(b"BoardPointer\x00"))
        for name in (b'BoardHarness', b'TestBoardPointer', b'BoardEvidenceHarness', b'BoardEvidenceData',
                     b'MoneyEvidenceGraph', b'MoneyEvidenceData', b'MoneyOverviewEvidenceHost',
                     b'MoneySessionEvidenceGraph', b'MoneySessionEvidenceData',
                     b'OfflineCampaignStoreDriver', b'StoreStartupDiagnostic'):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                metadata_check(name + b'\x00')

    def payload(self, omit=None, wrong_hash=False, dex=b'', extra=None):
        from inspect_android import sha
        selected = {a['name']: a for a in abis(self.toolchain, identity(self.toolchain, 'store'))}
        hashes = {name: {'source': sha(native(abi['elfMachine']))} for name, abi in selected.items()}
        if wrong_hash: hashes['x86_64']['source'] = '0' * 64
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('base/assets/bin/Data/Managed/Metadata/global-metadata.dat', b'')
            archive.writestr('base/dex/classes.dex', dex)
            for name, abi in selected.items():
                for library in ('libzkube_core_ffi.so', 'libil2cpp.so', 'libunity.so'):
                    path = f'base/lib/{name}/{library}'
                    if path != omit: archive.writestr(path, native(abi['elfMachine']))
            if extra: archive.writestr(extra, native())
        stream.seek(0)
        return store_payload(stream, 'base/', selected, hashes)

    def test_archive_requires_both_abis_and_exact_rust_hash(self):
        self.assertEqual(6, len(self.payload()))
        with self.assertRaises(RuntimeError): self.payload(omit='base/lib/x86_64/libzkube_core_ffi.so')
        with self.assertRaises(RuntimeError): self.payload(wrong_hash=True)
        with self.assertRaises(RuntimeError): self.payload(extra='base/lib/armeabi-v7a/libx.so')

    def test_archive_rejects_wallet_dex(self):
        for prefix in (b'Lcom/solana/', b'Lcom/solanamobile/', b'Lcom/zkorp/zkube/unitywallet/'):
            with self.assertRaises(RuntimeError): self.payload(dex=prefix + b'Wallet;')

    def test_shared_archive_missing_member_and_malformed_zip(self):
        with self.assertRaises(RuntimeError): open_archive(io.BytesIO(b'not a zip'))
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('unrelated', b'')
        stream.seek(0)
        with open_archive(stream) as archive:
            with self.assertRaises(RuntimeError): read_member(archive, 'universal.apk')

    def test_store_assembly_closure(self):
        paths = list((ROOT / 'unity/Assets/ZKube/Integration').rglob('*.asmdef'))
        paths += list((ROOT / 'unity/Assets/ThirdParty/Solana').rglob('*.asmdef'))
        self.assertGreaterEqual(len(paths), 9)
        for path in paths:
            self.assertIn('!ZKUBE_STORE', json.loads(path.read_text())['defineConstraints'])
        presentation = json.loads((ROOT / 'unity/Assets/ZKube/Runtime/Presentation/ZKube.Presentation.asmdef').read_text())
        self.assertFalse(set(presentation['references']) & set(MONEY_ASSEMBLIES))

    def test_store_manifest_rejects_wallet_and_wrong_identity(self):
        xml = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.zkorp.zkube.store" android:versionCode="1" android:versionName="1.0"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/><application android:allowBackup="false"><meta-data android:name="unity.splash-enable" android:value="false"/></application></manifest>'''
        profile = identity(self.toolchain, 'store')
        self.assertEqual('com.zkorp.zkube.store', store_manifest(xml, profile, self.toolchain)['package'])
        with self.assertRaises(RuntimeError): store_manifest(xml.replace('com.zkorp.zkube.store', 'com.zkorp.zkube'), profile, self.toolchain)
        with self.assertRaises(RuntimeError): store_manifest(xml.replace('</application>', '<activity android:name="com.zkorp.zkube.unitywallet.WalletActivity"/></application>'), profile, self.toolchain)


def main():
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(StaticTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise RuntimeError(f'Store build static checks failed: {len(result.failures)} failures, {len(result.errors)} errors')


if __name__ == '__main__':
    run_main(main, ROOT / 'build/unity')
