#!/usr/bin/env python3
"""Pure policy checks, plus explicit inspection of the two completed packages."""
import copy
import io
import json
from pathlib import Path
import struct
import sys
import unittest
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'unity/tools'))
from cli import run_main
from build import identity, abis
from inspect_android import elf, metadata_check, payload, manifest_check, MONEY_ASSEMBLIES
from inspect_android import open_archive, read_member, display_name_check, product_name_check
from inspect_android import production_check, debug_certificate


def native(machine=183, alignment=16384):
    value = bytearray(120)
    value[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', value, 18, machine)
    struct.pack_into('<Q', value, 32, 64)
    struct.pack_into('<HH', value, 54, 56, 1)
    struct.pack_into('<IIQQQQQQ', value, 64, 1, 5, 0, 0, 0, len(value), len(value), alignment)
    return bytes(value)


class StaticTests(unittest.TestCase):
    def test_both_package_manifests_use_the_identity_contract(self):
        for name in ('money', 'store'):
            profile = identity(self.toolchain, name)
            activity = ('<activity android:name="com.zkorp.zkube.unitywallet.WalletActivity" android:exported="false"/>'
                        if name == 'money' else '')
            xml = ('<manifest xmlns:android="http://schemas.android.com/apk/res/android" '
                   f'package="{profile["package"]}" android:versionCode="7" android:versionName="1.0">'
                   '<uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/>'
                   '<uses-permission android:name="android.permission.INTERNET"/>'
                   f'<application android:label="{profile["productName"]}" android:allowBackup="false">'
                   '<meta-data android:name="unity.splash-enable" android:value="false"/>'
                   + activity + '</application></manifest>')
            report = manifest_check(ET.fromstring(xml), profile, self.toolchain)
            self.assertEqual(profile['productName'], report['displayName'])
            self.assertEqual(7, report['versionCode'])
            with self.assertRaisesRegex(RuntimeError, 'display name'):
                manifest_check(ET.fromstring(xml.replace(profile['productName'], 'wrong')), profile, self.toolchain)

    def test_production_packages_require_explicit_version_and_non_debug_signing(self):
        for identity_name in ('money', 'store'):
            with self.subTest(identity=identity_name):
                report = dict(identity=identity_name, versionCode=17, debugSigned=True)
                production_check(report, None)
                self.assertEqual(report['distribution'], 'local-validation')
                with self.assertRaisesRegex(RuntimeError, 'debug-signed'):
                    production_check(report, 17)
                report['debugSigned'] = False
                for version in (0, 16):
                    with self.assertRaisesRegex(RuntimeError, 'version code'):
                        production_check(report, version)
                production_check(report, 17)
                self.assertEqual(report['distribution'], 'production-candidate')
        self.assertTrue(debug_certificate('Signer #1 certificate DN: CN=Android Debug, O=Android, C=US'))
        self.assertTrue(debug_certificate('Owner: CN=Unity Debug, O=Unity'))
        self.assertFalse(debug_certificate('Owner: CN=zKorp Release'))

    def setUp(self):
        self.toolchain = json.loads((ROOT / 'unity/toolchain.json').read_text())

    def test_profiles_preserve_money_and_add_two_abi_store(self):
        money = identity(self.toolchain, 'money')
        store = identity(self.toolchain, 'store')
        self.assertEqual(('com.zkorp.zkube', 'apk', ['arm64-v8a']), (money['package'], money['format'], money['abis']))
        self.assertEqual(['aarch64-linux-android', 'x86_64-linux-android'], [a['rustTarget'] for a in abis(self.toolchain, store)])
        self.assertIn('locks', money)
        self.assertNotIn('locks', store)

    def test_profile_rejects_unknown_and_duplicate_identities(self):
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'ios')
        self.toolchain['androidIdentities'].append(copy.deepcopy(self.toolchain['androidIdentities'][0]))
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'money')
        self.toolchain['androidIdentities'].pop()


    def test_missing_profile_field_is_expected_cli_failure(self):
        from contextlib import redirect_stdout
        del self.toolchain['androidIdentities'][1]['package']
        output = io.StringIO()
        with redirect_stdout(output), self.assertRaises(SystemExit) as result:
            run_main(lambda: identity(self.toolchain, 'store'))
        self.assertEqual(1, result.exception.code)
        self.assertIn('Malformed Android identity configuration', output.getvalue())
        self.assertNotIn('Traceback', output.getvalue())

    def test_profile_rejects_unknown_abi_and_lock_escape(self):
        self.toolchain['androidIdentities'][0]['abis'] = ['unknown']
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'money')
        self.toolchain['androidIdentities'][0]['abis'] = ['arm64-v8a']
        self.toolchain['androidIdentities'][0]['locks'] = '../money-locks'
        with self.assertRaises(RuntimeError): identity(self.toolchain, 'money')


    def test_display_name_checks_reject_wrong_missing_and_localized_names(self):
        publishing = json.loads((ROOT / 'unity/dapp-store/publishing.json').read_text())
        self.assertEqual(identity(self.toolchain, 'money')['productName'], publishing['displayName'])
        for name, expected in (('money', 'zKube: Arena'), ('store', 'zKube: Realms')):
            self.assertEqual(expected, identity(self.toolchain, name)['productName'])
            badge = "application-label:'" + expected + "'\n"
            self.assertEqual(expected, display_name_check(badge, expected))
            encoded = expected.encode('utf8')
            product_name_check(struct.pack('<I', len(encoded)) + encoded, expected)
            with self.assertRaises(RuntimeError): display_name_check('', expected)
            with self.assertRaises(RuntimeError): display_name_check("application-label:'zKube'", expected)
            with self.assertRaises(RuntimeError): display_name_check(badge + "application-label-fr:'zKube'", expected)
            with self.assertRaises(RuntimeError): product_name_check(b'zKube', expected)

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
        for name in (b'ZKube.Core.Tests', b'ZKube.Store.PlayTests', b'ZKube.Money.PlayTests'):
            for suffix in (b'\x00', b'.dll\x00'):
                with self.subTest(name=name, suffix=suffix), self.assertRaises(RuntimeError):
                    metadata_check(name + suffix)

    def test_money_metadata_excludes_the_local_daily_and_store_policy(self):
        from inspect_android import money_metadata_check
        money_metadata_check(b"LocalRunClient\x00CampaignRecordSync\x00")
        for token in (b"StoreRunClient", b"StoreCampaignPolicy", b"ZKube.Store.dll"):
            with self.subTest(token=token), self.assertRaises(RuntimeError):
                money_metadata_check(token + b"\x00")

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
        return payload(stream, 'base/', selected, hashes, identity(self.toolchain, 'store'))

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
        definitions = [json.loads(path.read_text()) for path in (ROOT / 'unity/Assets').rglob('*.asmdef')]
        names = {definition['name']: definition for definition in definitions}
        code = {'ZKube.' + name for name in ('Core', 'Presentation', 'Local', 'Chain', 'Money', 'Store', 'Editor')}
        expected = code | {name + '.Tests' for name in code} | {'ZKube.Store.PlayTests', 'ZKube.Money.PlayTests'}
        self.assertEqual(expected, set(names))
        self.assertEqual(len(expected), len(definitions))
        for name in ('ZKube.Chain', 'ZKube.Money'):
            self.assertEqual(['!ZKUBE_STORE'], names[name]['defineConstraints'])
        self.assertEqual(['UNITY_EDITOR || ZKUBE_STORE'], names['ZKube.Store']['defineConstraints'])
        self.assertIn('Chaos.NaCl.dll', names['ZKube.Chain']['precompiledReferences'])
        def closure(name, seen):
            self.assertNotIn(name, seen, 'Assembly reference cycle')
            self.assertNotIn(name, MONEY_ASSEMBLIES)
            for reference in names[name].get('references', []):
                if reference.startswith('ZKube.'):
                    self.assertIn(reference, code)
                    closure(reference, seen | {name})
        closure('ZKube.Store', set())

    def test_store_manifest_rejects_wallet_and_wrong_identity(self):
        xml = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.zkorp.zkube.store" android:versionCode="1" android:versionName="1.0"><uses-permission android:name="android.permission.INTERNET"/><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/><application android:allowBackup="false" android:label="zKube: Realms"><meta-data android:name="unity.splash-enable" android:value="false"/></application></manifest>'''
        profile = identity(self.toolchain, 'store')
        self.assertEqual('com.zkorp.zkube.store', manifest_check(ET.fromstring(xml), profile, self.toolchain)['package'])
        with self.assertRaises(RuntimeError): manifest_check(ET.fromstring(xml.replace('zKube: Realms', 'zKube')), profile, self.toolchain)
        with self.assertRaises(RuntimeError): manifest_check(ET.fromstring(xml.replace('com.zkorp.zkube.store', 'com.zkorp.zkube')), profile, self.toolchain)
        with self.assertRaises(RuntimeError): manifest_check(ET.fromstring(xml.replace('</application>', '<activity android:name="com.zkorp.zkube.unitywallet.WalletActivity"/></application>')), profile, self.toolchain)



if __name__ == '__main__':
    unittest.main()
