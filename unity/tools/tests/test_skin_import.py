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


def lost_inner_marks(path):
    """Inner marks a tab icon loses when it is selected.

    PageViews.TabBar tints a tab's icon with the text ink, and the selected one
    with the dark chip ink, which flattens every colour of the art to one dark
    fill: only what the art cuts out of its alpha still shows the chip through
    it. The unselected icon shows its marks as the art draws them over the dark
    bar. A mark is a blob inside the icon's outline darker than its fill; each
    one must be cut out of the alpha, or the selected icon loses it.
    """
    image = Image.open(path).convert('RGBA')
    width, height = image.size
    alpha = image.getchannel('A')
    shown = Image.alpha_composite(Image.new('RGBA', image.size, (0, 0, 0, 255)), image).convert('L')
    # The filled shape: every pixel the outside's transparency cannot reach.
    outside, edge = set(), [(x, y) for x in range(width) for y in (0, height - 1)] + [(x, y) for y in range(height) for x in (0, width - 1)]
    while edge:
        x, y = edge.pop()
        if (x, y) in outside or not (0 <= x < width and 0 <= y < height) or alpha.getpixel((x, y)) > 128: continue
        outside.add((x, y)); edge += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    hull = Image.new('L', image.size, 255)
    for point in outside: hull.putpixel(point, 0)
    # Well inside the outline stroke, the fill and the marks against it.
    inside = hull.filter(ImageFilter.MinFilter(17))
    filled = sorted(shown.getpixel((x, y)) for y in range(height) for x in range(width)
                    if inside.getpixel((x, y)) and alpha.getpixel((x, y)) > 128)
    fill = filled[len(filled) // 2]
    marks = {(x, y) for y in range(height) for x in range(width) if inside.getpixel((x, y)) and shown.getpixel((x, y)) < fill - 60}
    lost = []
    while marks:
        blob, todo = set(), [marks.pop()]
        while todo:
            x, y = todo.pop(); blob.add((x, y))
            for near in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if near in marks: marks.remove(near); todo.append(near)
        # A remnant of the outline is no mark; a mark is cut out where it is mostly transparent.
        if len(blob) >= 40 and sum(alpha.getpixel(point) < 128 for point in blob) < len(blob) / 2: lost.append(min(blob))
    return lost


class KitArt(unittest.TestCase):
    def test_every_tab_icon_keeps_its_inner_lines_when_selected(self):
        """The map's two folds, the gear's hole: what an unselected tab icon shows inside its outline is cut out of
        its alpha, so the selected icon shows the chip through it rather than losing it in its dark fill."""
        for slot in ("icon-home", "icon-campaign", "icon-profile", "icon-settings"):
            with self.subTest(slot=slot):
                self.assertEqual([], lost_inner_marks(ROOT / f"assets/skins/lumen/ui/{slot}.png"))

    def test_the_detector_finds_a_painted_line_and_passes_a_cut_one(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'build') as temporary:
            for cut, expected in ((False, 1), (True, 0)):
                image = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
                for x in range(8, 88):
                    for y in range(8, 88):
                        image.putpixel((x, y), (20, 20, 20, 255) if x < 12 or x > 83 or y < 12 or y > 83 else (220, 210, 190, 255))
                for x in range(46, 50):
                    for y in range(24, 72):
                        image.putpixel((x, y), (0, 0, 0, 0) if cut else (90, 80, 70, 255))
                path = Path(temporary) / f'line-{cut}.png'
                image.save(path)
                self.assertEqual(expected, len(lost_inner_marks(path)), "cut" if cut else "painted")
    def test_the_secondary_button_is_filled_moonstone_teal(self):
        """design/hud-brief-amend-2: the secondary button is deep moonstone-teal in every realm, one skin-global
        piece; an outline plate is the tertiary (quiet) button's look, drawn by code."""
        for skin in json.loads((ROOT / "assets/catalog.json").read_text())["skins"]:
            for slot in ("button-secondary", "button-secondary-pressed"):
                face = Image.open(ROOT / f"assets/skins/{skin}/ui/{slot}.png").convert("RGB")
                r, g, b = face.getpixel((face.width // 2, face.height // 2))
                self.assertTrue(g > r + 20 and b > r + 20 and min(g, b) > 60, f"{skin} {slot}: its face {(r, g, b)} is a filled teal")

    def test_each_guardians_recorded_head_top_is_its_first_opaque_row(self):
        """The HUD stands the crown over top_y_px: the first row any idle or acting frame is a quarter opaque in."""
        for contact_path in sorted((ROOT / "assets").glob("theme-*/boss/contact.json")):
            contact = json.loads(contact_path.read_text())
            top = min(Image.open(contact_path.parent / f"{name}.png").getchannel("A").point(lambda value: 255 if value >= 64 else 0).getbbox()[1]
                      for name in contact["frame_names"] if name != "portrait")
            self.assertEqual(top, contact["top_y_px"], contact_path.parent.parent.name)

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

    def test_every_icon_keeps_its_meaning_on_a_lit_face(self):
        """An icon on a lit face is its own picture: a dark body, and for an icon whose meaning is an
        inner shape (a dial, a fold, a screen) that shape cut through to the face's light, at the
        size it is authored and at 24 px. The codegen lists the icons and which carry such a shape."""
        catalog = json.loads((ROOT / 'assets/theme-catalog.generated.json').read_text())
        for skin in catalog['skins']:
            ui = {entry['slot']: ROOT / entry['image'].lstrip('/') for entry in skin['ui']}
            suffix = skin['litSuffix']
            icons = sorted(slot for slot in ui if slot.startswith('icon-') and not slot.endswith(suffix))
            self.assertGreater(len(icons), 30)
            self.assertTrue(set(skin['detailIcons']) <= set(icons))
            for icon in icons:
                with self.subTest(skin=skin['id'], icon=icon):
                    plain = Image.open(ui[icon]).convert('RGBA'); lit = Image.open(ui[icon + suffix]).convert('RGBA')
                    self.assertEqual(plain.size, lit.size)
                    body = [pixel for pixel in lit.get_flattened_data() if pixel[3] >= 200]
                    self.assertGreater(len(body), 1000, 'the lit picture has a body')
                    light = sum(.299 * red + .587 * green + .114 * blue for red, green, blue, _ in body) / len(body)
                    self.assertLess(light, 60, 'the body is dark, to read on the lit face')
                    width, height = lit.size
                    self.assertEqual(0, max(lit.getpixel(corner)[3] for corner in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))))
                    if icon not in skin['detailIcons']:
                        continue
                    # Where the icon is solid and its lit picture is open, the face's light shows through.
                    def windows(size, solid, clear):
                        ink = plain.resize(size, Image.LANCZOS).get_flattened_data(); cut = lit.resize(size, Image.LANCZOS).get_flattened_data()
                        return sum(1 for under, over in zip(ink, cut) if under[3] >= solid and over[3] <= clear)
                    self.assertGreaterEqual(windows(plain.size, 200, 60), 200, 'its inner shape is cut through to the light')
                    self.assertGreaterEqual(windows((24, 24), 160, 96), 2, 'and still is at 24 px')

    def test_the_detector_finds_a_painted_pin(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'build') as temporary:
            path = Path(temporary) / 'pinned.png'
            image = Image.new('RGBA', (96, 96), (30, 50, 70, 255))
            for x in range(40, 46):
                for y in range(40, 46):
                    image.putpixel((x, y), (230, 240, 250, 255))
            image.save(path)
            self.assertTrue(point_lights(path))

