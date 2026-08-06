#!/usr/bin/env python3
"""Scale-aware flip compositor — stage 4 of the guardian rig pipeline.

Generated rig frames are whole-image redraws and never pixel-stable against
the master; flip and face-only states must be composited before install:
the frame is aligned to base.png over translation AND scale (FFT phase
correlation on gradients), then only a feathered ellipse region is pasted
onto the base. Everything outside the region is copied from the base, which
is what makes the talk/blink flip rock-solid. The API's mask_url cannot do
this — it regenerates the whole canvas and treats the mask as advisory.

Emit a zone's committed masks (see MASKS below) into a rig dir:
  composite-flips.py --emit-masks 6 <dir>
Or build an ad-hoc mask (one or more x1,y1,x2,y2 ellipses in 1024-space):
  composite-flips.py --make-mask 405,215,615,305 <dir>/mask-eyes.png
Composite a frame:
  composite-flips.py <dir> <frame> <mask-name> <out-name>
  e.g. composite-flips.py /tmp/rigs/noctua-rig blink mask-eyes blink-composited

Read the printed inside-change: near zero means the generation was a no-op
(e.g. a blink that never closed the eyes) — reject and re-roll the frame.
Composite only states where the head stays put (the flip trio, satisfied);
a pose-changing state (surprised, greeting) pastes a displaced face over
the base's head and ghosts a double exposure — install those raw when their
framing is close. Always verify at full resolution by eye before install.
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCALES = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3]
FEATHER = 14

# Per-guardian mask ellipses in 1024-space, eyeballed from each zone's
# base.png master; emit them into a rig dir with --emit-masks. Re-eyeball a
# zone's boxes after any portrait or base redo that moves the face. Zones
# 1/2/3/10 predate the compositor and get boxes on their next regeneration.
MASKS = {
    4: {"eyes": (395, 145, 655, 260), "mouth": (445, 205, 620, 340)},
    5: {"eyes": (360, 430, 620, 525), "mouth": (350, 580, 640, 800)},
    6: {"eyes": (405, 215, 615, 305), "mouth": (420, 300, 605, 450)},
    7: {"eyes": (530, 300, 690, 375), "mouth": (540, 355, 700, 500)},
    8: {"eyes": (400, 455, 650, 555), "mouth": (420, 570, 630, 760)},
    9: {"eyes": (560, 90, 700, 170), "mouth": (550, 120, 800, 320)},
}


def make_mask(spec: str, out_path: str) -> None:
    mask = Image.new("RGBA", (1024, 1024), (0, 0, 0, 255))
    draw = ImageDraw.Draw(mask)
    nums = [int(v) for v in spec.split(",")]
    if len(nums) % 4 != 0:
        raise SystemExit("mask spec must be groups of x1,y1,x2,y2")
    for i in range(0, len(nums), 4):
        draw.ellipse(nums[i : i + 4], fill=(0, 0, 0, 0))
    mask.save(out_path)
    print(f"mask saved -> {out_path}")


def grad(x: np.ndarray) -> np.ndarray:
    return np.abs(np.diff(x, axis=1, prepend=x[:, :1])) + np.abs(
        np.diff(x, axis=0, prepend=x[:1])
    )


def composite(rig_dir: str, frame: str, mask_name: str, out_name: str) -> None:
    base = Image.open(f"{rig_dir}/base.png").convert("RGB")
    width, height = base.size
    raw = Image.open(f"{rig_dir}/{frame}.png").convert("RGB").resize((width, height))

    base_grad = grad(np.asarray(base.convert("L")).astype(float))
    base_fft = np.fft.rfft2(base_grad)

    best = None
    for scale in SCALES:
        w, h = int(width * scale), int(height * scale)
        canvas = Image.new("RGB", (width, height))
        canvas.paste(raw.resize((w, h), Image.LANCZOS), ((width - w) // 2, (height - h) // 2))
        frame_grad = grad(np.asarray(canvas.convert("L")).astype(float))
        corr = np.fft.irfft2(base_fft * np.conj(np.fft.rfft2(frame_grad)), s=base_grad.shape)
        idx = np.unravel_index(np.argmax(corr), corr.shape)
        if best is None or corr[idx] > best[0]:
            best = (corr[idx], scale, idx, canvas)
    _, scale, (dy, dx), canvas = best
    if dy > height // 2:
        dy -= height
    if dx > width // 2:
        dx -= width
    aligned = Image.fromarray(np.roll(np.roll(np.asarray(canvas), dy, axis=0), dx, axis=1))

    hole = Image.open(f"{rig_dir}/{mask_name}.png").split()[-1].point(lambda v: 255 - v)
    out = Image.composite(aligned, base, hole.filter(ImageFilter.GaussianBlur(FEATHER)))
    out.save(f"{rig_dir}/{out_name}.png")

    inside = np.asarray(hole) > 128
    a = np.asarray(base.convert("L")).astype(int)
    b = np.asarray(out.convert("L")).astype(int)
    print(
        f"{out_name}: scale={scale} shift=({dx},{dy}) "
        f"inside-change={round(np.abs(a - b)[inside].mean(), 1)} "
        f"whole={round(np.abs(a - b).mean(), 1)}"
    )


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--make-mask":
        make_mask(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == "--emit-masks":
        for name, box in MASKS[int(sys.argv[2])].items():
            make_mask(",".join(str(v) for v in box), f"{sys.argv[3]}/mask-{name}.png")
    elif len(sys.argv) == 5:
        composite(*sys.argv[1:5])
    else:
        raise SystemExit(__doc__)
