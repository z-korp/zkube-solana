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
    """The UI slots as the codegen emits them; its check guards the Rust owner."""
    catalog = json.loads((ROOT / 'assets/theme-catalog.generated.json').read_text())
    return {entry['slot'] for skin in catalog['skins'] for entry in skin['ui']}


def realm_images():
    """Every skin realm's images as the codegen emits them, by the same owner."""
    catalog = json.loads((ROOT / 'assets/theme-catalog.generated.json').read_text())
    return {image.removeprefix('/') for skin in catalog['skins'] for realm in skin['realms'] for image in realm['images'].values()}


def sound_effects():
    """Every sound cue's clip as the codegen emits it from its one cue list."""
    catalog = json.loads((ROOT / 'assets/theme-catalog.generated.json').read_text())
    return {clip.removeprefix('/') for clip in catalog['effects'].values()}


class PortraitImports(unittest.TestCase):
    def test_imports_only_the_assets_loaded_by_the_game(self):
        _, catalog = imports.asset_plan()
        skins = json.loads((ROOT / 'assets/catalog.json').read_text())['skins']
        expected = {'assets/common/mark.png', 'assets/common/sounds/musics/menu.mp3'}
        expected.update(sound_effects())
        for realm in range(1, 11):
            expected.update(f'assets/theme-{realm}/{name}.png' for name in
                            ['background'] + [f'boss/{frame}' for frame in
                             ('idle', 'blink', 'talk-mid', 'talk-open', 'greeting', 'satisfied', 'surprised',
                              'celebrate', 'defeated', 'portrait', 'paws')])
            expected.update(f'assets/theme-{realm}/sounds/musics/{track}.mp3' for track in ('level', 'boss'))
        expected.update(f'assets/skins/{skin}/ui/{name}.png' for skin in skins for name in skin_slots())
        expected.update(realm_images())
        self.assertEqual({entry['source'] for entry in catalog['assets']}, expected)
        frames = [entry for entry in catalog['assets'] if '/boss/' in entry['source'] and entry['scope'] != 'portraits']
        self.assertTrue(frames and all(entry['maxTextureSize'] == imports.GUARDIAN_TEXTURE for entry in frames),
                        'Guardian frames import at their device size')
        self.assertEqual({font['name'] for font in catalog['fonts']},
                         {'NotoSansSymbols2-Regular', 'NotoSansMath-Regular',
                          'Fraunces-650', 'LilitaOne-Regular', 'Nunito-700', 'Nunito-800', 'Nunito-900', 'Nunito-1000',
                          'NotoSansSC-700', 'NotoSansJP-700', 'NotoSansKR-700', 'NotoSerif-700'})
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
