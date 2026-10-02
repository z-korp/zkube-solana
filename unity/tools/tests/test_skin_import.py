"""Skin import plan: each skin UI kit and realm gets an atlas, and stretched slots keep their border."""
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build
from PIL import Image, ImageChops, ImageFilter

ROOT = TOOLS.parents[1]


def png(width, height):
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00"


def jpeg(width, height):
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + bytes(9)
    frame = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, height, width, 1) + bytes(3)
    return b"\xff\xd8" + app0 + frame + b"\xff\xd9"


class SkinImports(unittest.TestCase):
    def test_skin_ui_and_realm_slots_import_into_their_own_atlases_with_borders(self):
        with tempfile.TemporaryDirectory(dir=TOOLS.parents[1] / "build") as temporary:
            root = Path(temporary)
            base = root / "assets/skins/lumen"
            (base / "ui").mkdir(parents=True)
            (base / "realm-1").mkdir()
            (base / "ui/panel.png").write_bytes(png(256, 256))
            (base / "realm-1/block-2-1.png").write_bytes(png(384, 192))
            (base / "realm-1/ledge.png").write_bytes(png(1200, 48))
            (base / "realm-1/map.jpg").write_bytes(jpeg(1440, 4080))
            catalog = {"skins": [{"id": "lumen",
                "ui": [{"slot": "panel", "image": "/assets/skins/lumen/ui/panel.png", "border": [48, 40, 48, 40]}],
                "realms": [{"realmId": 1, "borders": {"ledge": [160, 0, 160, 0]},
                            "images": {"block-2-1": "/assets/skins/lumen/realm-1/block-2-1.png",
                                       "ledge": "/assets/skins/lumen/realm-1/ledge.png",
                                       "map": "/assets/skins/lumen/realm-1/map.jpg"}}]}]}
            entries, files = [], {}
            with patch.object(build, "ROOT", root), patch.object(build, "SOURCE", root / "assets"):
                scopes = build.skin_imports(catalog, entries, files)
            self.assertEqual(["skin-lumen-ui", "skin-lumen-theme-1"], scopes)
            panel, block, ledge, painting = entries
            self.assertEqual(([48, 40, 48, 40], "ZKube/Atlases/skin-lumen-ui"), (panel["border"], panel["atlas"]))
            self.assertEqual(([0, 0, 0, 0], 384, 192), (block["border"], block["width"], block["height"]))
            self.assertEqual(([160, 0, 160, 0], "ZKube/Atlases/skin-lumen-theme-1"), (ledge["border"], ledge["atlas"]))
            self.assertEqual(([0, 0, 0, 0], 1440, 4080), (painting["border"], painting["width"], painting["height"]))
            self.assertEqual({build.GENERATED / "Sprites/skin-lumen-ui/panel.png",
                              build.GENERATED / "Sprites/skin-lumen-theme-1/block-2-1.png",
                              build.GENERATED / "Sprites/skin-lumen-theme-1/ledge.png",
                              build.GENERATED / "Sprites/skin-lumen-theme-1/map.jpg"}, set(files))

            (base / "ui/panel.png").write_bytes(png(256, 256))
            policy = {"atlasMaxSize": 4096, "atlasPadding": 4}
            oversized = [dict(entries[1], width=1440, height=4096)]
            with self.assertRaisesRegex(RuntimeError, "must fit 4088 px"):
                build.check_atlas_fit(oversized, [], policy)
            build.check_atlas_fit([dict(entries[1], width=1440, height=4088)], [], policy)

            (base / "ui/panel.png").write_bytes(b"not a png")
            with patch.object(build, "ROOT", root), patch.object(build, "SOURCE", root / "assets"):
                with self.assertRaisesRegex(RuntimeError, "Not a PNG"):
                    build.skin_imports(catalog, [], {})
            (base / "ui/panel.png").write_bytes(png(256, 256))
            (base / "realm-1/map.jpg").write_bytes(png(1440, 4080))
            with patch.object(build, "ROOT", root), patch.object(build, "SOURCE", root / "assets"):
                with self.assertRaisesRegex(RuntimeError, "Not a PNG or JPEG"):
                    build.skin_imports(catalog, [], {})


if __name__ == "__main__":
    unittest.main()


def point_lights(path):
    """Isolated bright spots: blobs brighter than every neighbour 7 px away."""
    image = Image.open(path).convert('RGBA')
    light = image.convert('L')
    solid = image.getchannel('A').point(lambda a: 255 if a > 200 else 0)
    around = None
    for dx, dy in ((7, 0), (-7, 0), (0, 7), (0, -7), (5, 5), (5, -5), (-5, 5), (-5, -5)):
        shifted = ImageChops.offset(light, dx, dy)
        around = shifted if around is None else ImageChops.lighter(around, shifted)
    spots = ImageChops.multiply(ImageChops.subtract(light, around).point(lambda v: 255 if v > 40 else 0), solid)
    # A painted pin is a blob; a lone pixel is edge noise.
    spots = spots.filter(ImageFilter.MinFilter(3))
    width, height = image.size
    # The rim's single top-centre glint is the kit's light stroke.
    return [(x, y) for y in range(height) for x in range(width)
            if spots.getpixel((x, y)) and not (abs(x - width / 2) < width * .06 and y < height * .08)]


class KitArt(unittest.TestCase):
    def test_the_secondary_button_is_filled_moonstone_teal(self):
        """design/hud-brief-amend-2: the secondary button is deep moonstone-teal in every realm, one skin-global
        piece; an outline plate is the tertiary (quiet) button's look, drawn by code."""
        for skin in json.loads((ROOT / "assets/catalog.json").read_text())["skins"]:
            for slot in ("button-secondary", "button-secondary-pressed"):
                face = Image.open(ROOT / f"assets/skins/{skin}/ui/{slot}.png").convert("RGB")
                r, g, b = face.getpixel((face.width // 2, face.height // 2))
                self.assertTrue(g > r + 20 and b > r + 20 and min(g, b) > 60, f"{skin} {slot}: its face {(r, g, b)} is a filled teal")

    def test_only_the_wordmark_letters_change_colour_between_realms(self):
        """Each product's plaque keeps one colour in every realm and on the loading screen: from the letters'
        foot down, and around the letters' box, every colourway and the brand lockup carry the same pixels."""
        left, top, right, foot = 23, 22, 638, 216
        for product in ("realms", "arena"):
            brand = Image.open(ROOT / f"assets/brand/{product}/wordmark.png").convert("RGBA")
            realms = [Image.open(path).convert("RGBA") for path in sorted((ROOT / "assets/skins/lumen").glob(f"realm-*/wordmark-{product}.png"))]
            self.assertEqual(10, len(realms))
            letters = set()
            for realm in realms:
                self.assertEqual(brand.size, realm.size)
                # A difference image keeps the alpha band's difference, and getbbox reads only alpha when it has one.
                changed = ImageChops.difference(brand, realm).point(lambda value: 255 if value else 0).convert("RGB").getbbox() or \
                    ImageChops.difference(brand.getchannel("A"), realm.getchannel("A")).getbbox()
                if changed:
                    self.assertTrue(left <= changed[0] and top <= changed[1] and changed[2] <= right and changed[3] <= foot,
                                    f"{product}: a colourway changes pixels {changed} outside the letters")
                letters.add(realm.crop((left, top, right, foot)).tobytes())
            self.assertEqual(10, len(letters), f"{product}: every realm colours the letters its own way")

    def test_no_sliced_kit_piece_carries_a_stray_point_light(self):
        catalog = json.loads((ROOT / 'assets/theme-catalog.generated.json').read_text())
        sliced = [entry for skin in catalog['skins'] for entry in skin['ui'] if any(entry['border'])]
        self.assertGreater(len(sliced), 10)
        for entry in sliced:
            with self.subTest(slot=entry['slot']):
                self.assertEqual([], point_lights(ROOT / entry['image'].lstrip('/'))[:5])

    def test_the_detector_finds_a_painted_pin(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'build') as temporary:
            path = Path(temporary) / 'pinned.png'
            image = Image.new('RGBA', (96, 96), (30, 50, 70, 255))
            for x in range(40, 46):
                for y in range(40, 46):
                    image.putpixel((x, y), (230, 240, 250, 255))
            image.save(path)
            self.assertTrue(point_lights(path))

