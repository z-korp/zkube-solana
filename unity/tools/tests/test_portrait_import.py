"""Read-only import-plan tests; original guardian PNG bytes stay unchanged."""
from pathlib import Path
import hashlib
import json
import importlib.util
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'unity/tools'))
from cli import run_main
import build as imports


def skin_slots():
    source = (ROOT / 'crates/zkube-codegen/src/skins.rs').read_text()
    import re
    lists = re.findall(r'UI_(?:STRETCH|FIXED)_SLOTS: \[&str; \d+\] = \[(.*?)\];', source, re.S)
    return [name for block in lists for name in re.findall(r'"([a-z0-9-]+)"', block)]


class PortraitImports(unittest.TestCase):
    def test_imports_only_the_assets_loaded_by_the_game(self):
        _, catalog = imports.asset_plan()
        skins = json.loads((ROOT / 'assets/catalog.json').read_text())['skins']
        expected = {'assets/common/bonus/tiki.png', 'assets/common/mark.png'}
        expected.update(f'assets/common/sounds/effects/{name}.mp3'
                        for name in ('star', 'constraint-complete', 'victory', 'over'))
        for realm in range(1, 11):
            expected.update(f'assets/theme-{realm}/{name}.png' for name in
                            ['background'] + [f'boss/{frame}' for frame in
                             ('idle', 'blink', 'talk-mid', 'talk-open', 'greeting', 'satisfied', 'surprised',
                              'celebrate', 'defeated', 'portrait', 'paws')])
            expected.update(f'assets/skins/{skin}/realm-{realm}/{name}' for skin in skins for name in
                            ('background.jpg', 'hud-background.jpg', 'map.jpg', 'ledge.png', 'mote.png',
                             'block-1.png', 'block-2.png', 'block-3.png', 'block-4.png'))
            expected.add(f'assets/theme-{realm}/sounds/musics/level.mp3')
        expected.update(f'assets/skins/{skin}/ui/{name}.png' for skin in skins for name in skin_slots())
        self.assertEqual({entry['source'] for entry in catalog['assets']}, expected)
        frames = [entry for entry in catalog['assets'] if '/boss/' in entry['source'] and entry['scope'] != 'portraits']
        self.assertTrue(frames and all(entry['maxTextureSize'] == imports.GUARDIAN_TEXTURE for entry in frames),
                        'Guardian frames import at their device size')
        self.assertEqual({font['name'] for font in catalog['fonts']},
                         {'NotoSansSymbols2-Regular', 'NotoSansMath-Regular',
                          'Fraunces-650', 'Nunito-700', 'Nunito-800', 'Nunito-900', 'Nunito-1000'})
        body = next(font for font in catalog['fonts'] if font['name'] == 'Nunito-700')
        settings = (imports.PROJECT / 'Assets/TextMesh Pro/Resources/TMP Settings.asset').read_text()
        self.assertIn('m_defaultFontAsset: {fileID: 1, guid: ' + body['fontAssetGuid'], settings)

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
    run_main(main, ROOT / 'build/unity/store-portrait-import')
