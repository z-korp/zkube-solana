#!/usr/bin/env python3
"""Key, centre and install generated ladder tier frames.

Three fixes, all needed before a frame can be composited.

**Transparency.** GPT Image does not return an alpha channel here — it *paints*
a grey-and-white checkerboard where the transparency should be, so the file
looks correct in a viewer and is fully opaque in fact. The checker is keyed by
flood-filling from the corners and from the centre, so an ornament highlight
that happens to be near-white survives: it is not connected to the background.

**Centring.** The block must sit in the middle of the opening, not the middle
of the artwork — jade's lower leaves are far heavier than its top, so the two
are not the same point. Each frame is repadded around its opening's centre.

**Geometry.** The openings come out anywhere from half the canvas to three
quarters of it. Forcing them all to one ratio would crop the ornament off the
elaborate tiers, so instead each frame keeps its own overhang and this script
prints the per-tier ratio table for `TierFrame` to render against. A higher
tier legitimately reaches further past the block than a lower one.

    python3 client/tools/sprites/install-tier-frames.py <generated-dir>
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT_SIZE = 512
OPEN_ALPHA = 24
# The painted checkerboard's two greys, and how far a pixel may stray from
# either and still count as background.
CHECKER = ((250, 250, 250), (232, 232, 232))
CHECKER_TOLERANCE = 10
DEST = Path(__file__).resolve().parents[2] / "public" / "assets" / "common"


def key_checkerboard(image: Image.Image) -> Image.Image:
    """Replace the painted checkerboard with real transparency."""
    rgb = np.array(image.convert("RGB")).astype(np.int16)
    background = np.zeros(rgb.shape[:2], dtype=bool)
    for colour in CHECKER:
        background |= np.all(np.abs(rgb - np.array(colour)) <= CHECKER_TOLERANCE, axis=2)

    height, width = background.shape
    seeds = [
        (0, 0),
        (0, width - 1),
        (height - 1, 0),
        (height - 1, width - 1),
        (height // 2, width // 2),
    ]
    reached = np.zeros_like(background)
    stack = [seed for seed in seeds if background[seed]]
    for seed in stack:
        reached[seed] = True
    while stack:
        y, x = stack.pop()
        left = x
        while left > 0 and background[y, left - 1] and not reached[y, left - 1]:
            left -= 1
            reached[y, left] = True
        right = x
        while right < width - 1 and background[y, right + 1] and not reached[y, right + 1]:
            right += 1
            reached[y, right] = True
        for neighbour in (y - 1, y + 1):
            if 0 <= neighbour < height:
                span = background[neighbour, left : right + 1] & ~reached[neighbour, left : right + 1]
                for offset in np.flatnonzero(span):
                    column = left + int(offset)
                    reached[neighbour, column] = True
                    stack.append((neighbour, column))

    out = image.convert("RGBA")
    alpha = np.array(out)[..., 3]
    alpha[reached] = 0
    out.putalpha(Image.fromarray(alpha))
    return out


def opening_box(alpha: np.ndarray) -> tuple[float, float, float]:
    """Centre and side of the frame's hole.

    The hole is a rounded rectangle around the middle, so the transparent run
    through the centre row and centre column measures it directly — no
    connected-component pass needed, and no risk of latching onto the
    transparent background outside the ornament.
    """
    height, width = alpha.shape
    midy, midx = height // 2, width // 2

    def run(line: np.ndarray, start: int) -> tuple[int, int]:
        if line[start] >= OPEN_ALPHA:
            raise SystemExit("centre pixel is opaque — this frame has a filled middle")
        low = start
        while low > 0 and line[low - 1] < OPEN_ALPHA:
            low -= 1
        high = start
        while high < len(line) - 1 and line[high + 1] < OPEN_ALPHA:
            high += 1
        return low, high

    x0, x1 = run(alpha[midy, :], midx)
    y0, y1 = run(alpha[:, midx], midy)
    return (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0)


def main() -> None:
    source = Path(sys.argv[1])
    frames = sorted(source.glob("tier-*.png"))
    if not frames:
        raise SystemExit(f"no tier-*.png in {source}")
    ratios = []
    for path in frames:
        tier = int(path.name.split("-")[1])
        image = key_checkerboard(Image.open(path))
        alpha = np.array(image)[..., 3]
        cx, cy, side = opening_box(alpha)

        # Square the canvas around the OPENING's centre, wide enough to hold
        # every opaque pixel — so nothing is cropped and the block still lands
        # dead centre.
        ys, xs = np.nonzero(alpha > 0)
        radius = int(
            np.ceil(
                max(
                    cx - xs.min(),
                    xs.max() - cx,
                    cy - ys.min(),
                    ys.max() - cy,
                )
            )
        )
        canvas = Image.new("RGBA", (radius * 2, radius * 2), (0, 0, 0, 0))
        canvas.alpha_composite(image, (round(radius - cx), round(radius - cy)))
        canvas = canvas.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)

        out = DEST / f"tier-{tier}.png"
        canvas.save(out, optimize=True)
        ratio = side / (radius * 2)
        ratios.append((tier, ratio))
        print(
            f"tier {tier}: opening {ratio:.4f} of frame -> {out.name} "
            f"{out.stat().st_size // 1024}KB"
        )

    print("\nTIER_FRAME_OPENINGS for TierFrame.tsx:")
    print(
        "  [" + ", ".join(f"{ratio:.4f}" for _, ratio in sorted(ratios)) + "]"
    )


if __name__ == "__main__":
    main()
