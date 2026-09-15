"""Read-only import-plan tests; original guardian PNG bytes stay unchanged."""
from pathlib import Path
import hashlib
import importlib.util
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
STAGE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'unity/tools'))
from cli import run_main

source = STAGE / 'import_assets.py'
if not source.is_file():
    source = ROOT / 'unity/tools/import_assets.py'
spec = importlib.util.spec_from_file_location('portrait_import_assets', source)
imports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imports)
imports.ROOT = ROOT
imports.PROJECT = ROOT / 'unity'
imports.GENERATED = imports.PROJECT / 'Assets/ZKube/Art/Generated'


class PortraitImports(unittest.TestCase):
    def inputs(self):
        catalog = {'themes': []}; by_source = {}; entries = []; files = {}
        for realm in range(1, 11):
            scope = f'theme-{realm}'
            relative = f'assets/{scope}/boss/idle.png'
            data = (ROOT / relative).read_bytes()
            asset = f'Assets/ZKube/Art/Generated/Sprites/{scope}/boss__idle.png'
            entry = dict(source=relative, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
                         scope=scope, name='boss__idle', sprite='boss__idle', kind='sprite', asset=asset,
                         atlas=f'ZKube/Atlases/{scope}', guid='test-original')
            uri = f'/assets/{scope}/boss/idle.png'
            by_source[uri] = entry; entries.append(entry); files[imports.PROJECT / asset] = data
            catalog['themes'].append(dict(realmId=realm, id=scope, guardianPortrait=uri))
        return catalog, by_source, entries, files

    def test_ten_imports_keep_exact_png_bytes_provenance_and_one_small_scope(self):
        catalog, lookup, entries, files = self.inputs()
        originals = dict(lookup)
        portraits = imports.portrait_imports(catalog, lookup, entries, files)
        self.assertEqual(len(portraits), 10)
        self.assertEqual({row['atlas'] for row in portraits}, {'ZKube/Atlases/portraits'})
        self.assertEqual(lookup, originals, 'thumbnail copies cannot override realm sprite resolution')
        for row in portraits:
            entry = next(value for value in entries if value['scope'] == 'portraits' and value['sprite'] == row['sprite'])
            self.assertEqual(entry['maxTextureSize'], 256)
            self.assertEqual(files[imports.PROJECT / entry['asset']], (ROOT / row['source']).read_bytes())
            self.assertEqual(hashlib.sha256(files[imports.PROJECT / entry['asset']]).hexdigest(), row['sha256'])

    def test_cross_realm_source_binding_is_rejected(self):
        catalog, lookup, entries, files = self.inputs()
        catalog['themes'][0]['guardianPortrait'] = '/assets/theme-2/boss/idle.png'
        with self.assertRaisesRegex(RuntimeError, 'canonical existing theme'):
            imports.portrait_imports(catalog, lookup, entries, files)

    def test_duplicate_realm_cannot_alias_an_existing_import(self):
        catalog, lookup, entries, files = self.inputs()
        catalog['themes'].append(catalog['themes'][0])
        with self.assertRaisesRegex(RuntimeError, 'Duplicate portrait realm'):
            imports.portrait_imports(catalog, lookup, entries, files)


def main():
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PortraitImports))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    run_main(main, ROOT / 'build/unity/harness/store-portrait-import')
