#!/usr/bin/env python3
"""Centre and install matted ladder tier frames.

Input is the output of ``matte-alpha.mjs``, not the raw generation: GPT Image
never returns an alpha channel here, and chroma-keying its background left
white residue in the ornament. Frames arrive already cut and this script
refuses any that are not.

Two fixes remain.

**Centring.** The block must sit in the middle of the opening, not the middle
of the artwork — jade's lower leaves are far heavier than its top, so the two
are not the same point. Each frame is repadded around its opening's centre.

**Geometry.** The openings come out anywhere from half the canvas to three
quarters of it. Forcing them all to one ratio would crop the ornament off the
elaborate tiers, so instead each frame keeps its own overhang and this script
prints the per-tier ratio table for `TierFrame` to render against. A higher
tier legitimately reaches further past the block than a lower one.

    node assets/tools/matte-alpha.mjs raw/*.png --out matted
    python3 assets/tools/install-tier-frames.py matted
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT_SIZE = 512
OPEN_ALPHA = 24
DEST = Path(__file__).resolve().parents[1] / "common"


def require_matted(alpha: np.ndarray, name: str) -> None:
    """Refuse art that still carries its background.

    The failure this catches is silent otherwise: a checkerboard painted into
    the pixels looks transparent in every viewer and composites as a grey grid
    behind the ornament.
    """
    corners = [alpha[0, 0], alpha[0, -1], alpha[-1, 0], alpha[-1, -1]]
    if max(corners) > OPEN_ALPHA:
        raise SystemExit(
            f"{name}: corners are opaque — run matte-alpha.mjs on it first"
        )


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
        image = Image.open(path).convert("RGBA")
        alpha = np.array(image)[..., 3]
        require_matted(alpha, path.name)
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
