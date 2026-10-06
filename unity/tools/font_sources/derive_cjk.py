#!/usr/bin/env python3
"""Derives the three script fonts from Noto Sans CJK and pins them in provenance.json.

Each is a static TrueType subset at weight 700 of the variable collection: Simplified Chinese keeps GB 2312
level 1, Japanese JIS X 0208 level 1 with the kana, Korean the KS X 1001 Hangul, each with the full-width
punctuation and whatever its words in assets/words use beyond that set. None keeps a Latin letter, a digit or a
space: the text fonts draw those. Run it again when the font import names a character no font draws.

    build/art/.venv/bin/python unity/tools/font_sources/derive_cjk.py [NotoSansCJK-VF.ttc]
"""
import hashlib, json, pathlib, sys
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont, newTable

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/google-noto-sans-cjk-vf-fonts/NotoSansCJK-VF.ttc")
WEIGHT = 700


def rows(codec, first, last):
    found = set()
    for high in range(first, last + 1):
        for low in range(0xA1, 0xFF):
            try:
                found.update(map(ord, bytes([high, low]).decode(codec)))
            except UnicodeDecodeError:
                pass
    return found


PUNCTUATION = set(range(0x3000, 0x3020)) | set(range(0xFF01, 0xFF5F)) | {0x30FB, 0x30FC, 0xFFE5}
KANA = set(range(0x3041, 0x3097)) | set(range(0x30A1, 0x30FB))
# Language, the collection's face, its number in the collection, its everyday set.
FACES = [
    ("zh-Hans", "SC", 2, rows("gb2312", 0xB0, 0xD7)),
    ("ja", "JP", 0, rows("euc_jp", 0xB0, 0xCF) | KANA),
    ("ko", "KR", 1, rows("euc_kr", 0xB0, 0xC8)),
]


def used(code):
    words = json.loads((ROOT / "assets/words" / f"{code}.json").read_text())
    texts = [text for value in words.values() for text in (value.values() if isinstance(value, dict) else value if isinstance(value, list) else [value])]
    return {ord(c) for text in texts for c in text if ord(c) > 0x2E7F}


def derive(code, face, number, everyday):
    font = TTFont(str(SOURCE), fontNumber=number, lazy=True)
    if font["name"].getDebugName(1) != f"Noto Sans CJK {face}":
        raise SystemExit(f"Face {number} of {SOURCE.name} is not Noto Sans CJK {face}")
    wanted = everyday | PUNCTUATION | used(code)
    missing = sorted(used(code) - set(font.getBestCmap()))
    if missing:
        raise SystemExit(f"{code}: Noto Sans CJK {face} has no " + ", ".join(f"U+{c:04X}" for c in missing))
    options = Options()
    options.layout_features = []
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.notdef_outline = True
    options.glyph_names = False
    options.hinting = False
    options.drop_tables += ["BASE", "VORG", "vhea", "vmtx", "VVAR", "DSIG"]
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=wanted)
    subsetter.subset(font)
    # fontTools cannot instance this CFF2 font, so each outline and advance is drawn at the weight instead.
    drawn = font.getGlyphSet(location={"wght": WEIGHT})
    order = font.getGlyphOrder()
    glyf = newTable("glyf")
    glyf.glyphs, glyf.glyphOrder, widths = {}, order, {}
    for name in order:
        pen = TTGlyphPen(None)
        drawn[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
        widths[name] = round(drawn[name].width)
    font["glyf"], font["loca"] = glyf, newTable("loca")
    for tag in ("CFF2", "HVAR", "MVAR", "STAT", "avar", "fvar"):
        if tag in font:
            del font[tag]
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for field in ("maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs", "maxStackElements", "maxSizeOfInstructions",
                  "maxComponentElements", "maxComponentDepth", "maxPoints", "maxContours", "maxCompositePoints", "maxCompositeContours"):
        setattr(maxp, field, 0)
    maxp.maxZones = 1
    for name, glyph in glyf.glyphs.items():
        glyph.recalcBounds(glyf)
        font["hmtx"][name] = (widths[name], getattr(glyph, "xMin", 0))
    font["post"].formatType = 3.0
    font["head"].indexToLocFormat = 1
    font["OS/2"].usWeightClass = WEIGHT
    font.sfntVersion = "\x00\x01\x00\x00"
    family, style = f"Noto Sans {face}", str(WEIGHT)
    names = font["name"]
    for name_id in (1, 2, 3, 4, 6, 16, 17, 25):
        names.removeNames(nameID=name_id)
    for name_id, value in ((1, f"{family} {style}"), (2, "Regular"), (3, f"{family.replace(' ', '')}-{style}"), (4, f"{family} {style}"),
                           (6, f"{family.replace(' ', '')}-{style}"), (16, family), (17, style)):
        names.setName(value, name_id, 3, 1, 0x409)
    # The same input gives the same bytes: no save time in the file.
    font.recalcTimestamp = False
    font["head"].modified = font["head"].created
    path = HERE / "NotoSansCJK" / f"NotoSans{face}-{WEIGHT}.ttf"
    path.parent.mkdir(exist_ok=True)
    font.save(str(path))
    return path, len(order)


def main():
    lock_path = HERE / "provenance.json"
    lock = json.loads(lock_path.read_text())
    source = next(entry for entry in lock["sources"] if entry["family"] == "Noto Sans CJK")
    found = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if found != source["derived"][0]["fromSha256"]:
        raise SystemExit(f"{SOURCE} is not the pinned collection: {found}")
    for code, face, number, everyday in FACES:
        path, glyphs = derive(code, face, number, everyday)
        lock["sha256"][path.relative_to(HERE).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
        print(f"{path.name}: {glyphs} glyphs, {path.stat().st_size} bytes")
    lock["sha256"] = dict(sorted(lock["sha256"].items()))
    lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
