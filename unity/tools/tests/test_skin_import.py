"""Skin import plan: each skin UI kit and realm gets an atlas, and stretched slots keep their border."""
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build


def png(width, height):
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00"


class SkinImports(unittest.TestCase):
    def test_skin_ui_and_realm_slots_import_into_their_own_atlases_with_borders(self):
        with tempfile.TemporaryDirectory(dir=TOOLS.parents[1] / "build") as temporary:
            root = Path(temporary)
            base = root / "assets/skins/jelly"
            (base / "ui").mkdir(parents=True)
            (base / "realm-1").mkdir()
            (base / "ui/panel.png").write_bytes(png(256, 256))
            (base / "realm-1/block-2-1.png").write_bytes(png(384, 192))
            catalog = {"skins": [{"id": "jelly",
                "ui": [{"slot": "panel", "image": "/assets/skins/jelly/ui/panel.png", "border": [48, 40, 48, 40]}],
                "realms": [{"realmId": 1, "images": {"block-2-1": "/assets/skins/jelly/realm-1/block-2-1.png"}}]}]}
            entries, files = [], {}
            with patch.object(build, "ROOT", root), patch.object(build, "SOURCE", root / "assets"):
                scopes = build.skin_imports(catalog, entries, files)
            self.assertEqual(["skin-jelly-ui", "skin-jelly-theme-1"], scopes)
            panel, block = entries
            self.assertEqual(([48, 40, 48, 40], "ZKube/Atlases/skin-jelly-ui"), (panel["border"], panel["atlas"]))
            self.assertEqual(([0, 0, 0, 0], 384, 192), (block["border"], block["width"], block["height"]))
            self.assertEqual({build.GENERATED / "Sprites/skin-jelly-ui/panel.png",
                              build.GENERATED / "Sprites/skin-jelly-theme-1/block-2-1.png"}, set(files))

            (base / "ui/panel.png").write_bytes(b"not a png")
            with patch.object(build, "ROOT", root), patch.object(build, "SOURCE", root / "assets"):
                with self.assertRaisesRegex(RuntimeError, "Not a PNG"):
                    build.skin_imports(catalog, [], {})


if __name__ == "__main__":
    unittest.main()
