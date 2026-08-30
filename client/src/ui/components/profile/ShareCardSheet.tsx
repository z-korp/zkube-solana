import { useEffect, useState } from "react";

import { getGuardianPortrait } from "@/config/bossCharacters";
import {
  GUARDIAN_FACE_CROPS,
  GUARDIAN_TIER_COLORS,
} from "@/config/guardianBlocks";
import { ladderTierColor, ladderTierName } from "@/config/ladderTiers";
import { getThemeId, getThemeImages } from "@/config/themes";
import { tierFrameOuterSize } from "@/config/tierFrames";
import { SOL_LOGO_PATH } from "@/ui/components/economy/SolMark";
import Sheet from "@/ui/components/shared/Sheet";
import { formatSolBalanceLamports } from "@/utils/currency";

const GOLD = "#FACC15";
const CREAM = "#FFF4D7";
const WIDTH = 1080;
const HEIGHT = 1350;

/** Content box of the supplied MagicBlock logomark inside its 1536² canvas. */
const MAGICBLOCK_BOX = [243, 288, 1049, 962] as const;

export interface ShareCardData {
  displayName: string;
  /** Featured emblem id; a guardian face renders for 1..10, zone 1 otherwise. */
  featuredEmblem: number;
  /** Ladder border the player wears, drawn around the emblem. */
  frameTier: number;
  ladderPoints: bigint;
  totalStars: number;
  totalEarnedLamports: bigint;
  entryStreakDays: number;
  /** Best payout-bearing rank across both boards; 0 when never placed. */
  bestPrizeRank: number;
}

// PARKED 2026-08-29 — owner ruling; not reachable from the product until unparked
interface ShareCardSheetProps {
  open: boolean;
  onClose: () => void;
  data: ShareCardData;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`share card: ${src} failed`));
    img.src = src;
  });
}

/** Squarified full-head crop, same math as the face windows. */
function faceCrop(zoneId: number): [number, number, number] {
  const [x1, y1, x2, y2] = GUARDIAN_FACE_CROPS[zoneId] ??
    GUARDIAN_FACE_CROPS[1];
  const side = Math.max(x2 - x1, y2 - y1);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const sx = Math.max(0, Math.min(512 - side, cx - side / 2));
  const sy = Math.max(0, Math.min(512 - side, cy - side / 2));
  return [sx, sy, side];
}


/** The profile's flame, drawn straight onto the card. */
function drawFlame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const h = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.bezierCurveTo(h * 0.75, -h * 0.25, h * 0.6, h * 0.5, 0, h);
  ctx.bezierCurveTo(-h * 0.6, h * 0.5, -h * 0.75, -h * 0.25, 0, -h);
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.1);
  ctx.bezierCurveTo(h * 0.42, h * 0.25, h * 0.3, h * 0.7, 0, h * 0.86);
  ctx.bezierCurveTo(-h * 0.3, h * 0.7, -h * 0.42, h * 0.25, 0, -h * 0.1);
  ctx.closePath();
  ctx.fillStyle = "#FFF0A8";
  ctx.fill();
  ctx.restore();
}

/**
 * The platforms this runs on, along the foot of the card.
 *
 * Solana and MagicBlock draw their own marks — the white MagicBlock logomark,
 * since the card's foot is always dark. Nothing here is set as a wordmark:
 * inventing a mark for somebody else's brand is worse than leaving them off,
 * so a platform joins this strip when its official asset lands in
 * `public/assets/common/`.
 */
async function drawPlatformStrip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
): Promise<void> {
  const MARK = 46;
  const GAP = 40;

  let magicBlock: HTMLImageElement | null = null;
  try {
    magicBlock = await loadImage("/assets/common/MagicBlock-Logomark-White.png");
  } catch {
    // mark unavailable — the strip degrades to the two it can draw
  }
  const magicWidth = magicBlock ? MARK * 1.09 : 0;
  const parts = [MARK, magicWidth].filter((w) => w > 0);
  const total =
    parts.reduce((sum, w) => sum + w, 0) + GAP * (parts.length - 1);
  let cursor = cx - total / 2;

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(cursor, y - MARK * 0.44);
  ctx.scale(MARK / 101, MARK / 101);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill(new Path2D(SOL_LOGO_PATH));
  ctx.restore();
  cursor += MARK + GAP;

  // Both centre on `y`: the Solana path is 101x88 drawn from its own top and
  // the logomark is drawn from its own centre.

  if (magicBlock) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    // The supplied logomark is a 1536² canvas with the mark inset; draw its
    // content box so it lands the same visual size as the Solana mark rather
    // than a third smaller.
    ctx.drawImage(
      magicBlock,
      MAGICBLOCK_BOX[0],
      MAGICBLOCK_BOX[1],
      MAGICBLOCK_BOX[2],
      MAGICBLOCK_BOX[3],
      cursor,
      y - MARK * 0.5,
      magicWidth,
      MARK,
    );
    ctx.restore();
  }
  ctx.textAlign = "center";
}

/**
 * The one number worth leading with.
 *
 * A card with four equal figures brags about nothing. Money first when there
 * is money, then a placement, then the climb — so a player who has never been
 * paid still has something to post.
 */
function headline(data: ShareCardData): {
  label: string;
  value: string;
  sol: boolean;
} {
  if (data.totalEarnedLamports > 0n) {
    return {
      label: "WON ON ZKUBE",
      value: formatSolBalanceLamports(data.totalEarnedLamports),
      sol: true,
    };
  }
  if (data.bestPrizeRank > 0) {
    return { label: "BEST FINISH", value: `#${data.bestPrizeRank}`, sol: false };
  }
  return {
    label: "LADDER POINTS",
    value: Number(data.ladderPoints).toLocaleString(),
    sol: false,
  };
}

/**
 * The card a player posts to show off.
 *
 * Built around the two things they chose — the guardian they wear and the
 * border they earned — over that realm's own painted art, because those are
 * what a stranger sees first. One headline number carries the brag and the
 * supporting figures stay small.
 *
 * The wallet address is gone: nobody flexes a truncated base58, and it was the
 * only line on the card that helped no one. The invitation at the foot is the
 * point of sharing at all — a card a stranger cannot act on is a card that
 * brings nobody back.
 */
async function drawCard(data: ShareCardData): Promise<string> {
  await document.fonts.load('80px "Fredericka the Great"').catch(() => []);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("share card: no canvas context");

  const zoneId =
    data.featuredEmblem >= 1 && data.featuredEmblem <= 10
      ? data.featuredEmblem
      : 1;
  const accent = GUARDIAN_TIER_COLORS[zoneId] ?? "#4E7BE0";
  const tierColor = ladderTierColor(data.frameTier);

  // The realm's own art is the ground, pushed back far enough that the
  // guardian block stays the subject.
  ctx.fillStyle = "#05070F";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  try {
    const art = await loadImage(getThemeImages(getThemeId(zoneId)).background);
    const scale = Math.max(WIDTH / art.width, HEIGHT / art.height);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.drawImage(
      art,
      (WIDTH - art.width * scale) / 2,
      (HEIGHT - art.height * scale) / 2,
      art.width * scale,
      art.height * scale,
    );
    ctx.restore();
  } catch {
    // realm art unavailable — the accent wash below still carries the card
  }
  const wash = ctx.createRadialGradient(
    WIDTH / 2,
    HEIGHT * 0.32,
    80,
    WIDTH / 2,
    HEIGHT * 0.32,
    HEIGHT * 0.85,
  );
  wash.addColorStop(0, `${accent}4d`);
  wash.addColorStop(0.45, "rgba(5,7,15,0.68)");
  wash.addColorStop(1, "rgba(5,7,15,0.95)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";

  ctx.fillStyle = CREAM;
  ctx.font = '64px "Fredericka the Great"';
  ctx.fillText("zKube", WIDTH / 2, 128);

  // The guardian's bust inside the border — the two things the player chose.
  // No block body: the frame is the chrome, and a coloured square inside an
  // ornate border makes the guardian the smallest thing in its own avatar.
  const size = 356;
  const bx = WIDTH / 2 - size / 2;
  const by = 214;
  roundedRect(ctx, bx, by, size, size, size * 0.22);
  ctx.save();
  ctx.clip();
  const seat = ctx.createRadialGradient(
    bx + size / 2,
    by + size * 0.38,
    10,
    bx + size / 2,
    by + size * 0.38,
    size * 0.78,
  );
  seat.addColorStop(0, accent);
  seat.addColorStop(1, "#0A0E18");
  ctx.fillStyle = seat;
  ctx.fillRect(bx, by, size, size);
  try {
    const img = await loadImage(getGuardianPortrait(zoneId));
    const [sx, sy, side] = faceCrop(zoneId);
    ctx.filter = "brightness(1.24) saturate(1.24) contrast(1.04)";
    ctx.drawImage(img, sx, sy, side, side, bx, by, size, size);
    ctx.filter = "none";
  } catch {
    // face art unavailable — the seat colour alone still reads as the realm
  }
  const gloss = ctx.createLinearGradient(0, by, 0, by + size * 0.42);
  gloss.addColorStop(0, "rgba(255,255,255,0.2)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(bx, by, size, size * 0.42);
  ctx.restore();
  try {
    const frame = await loadImage(`/assets/common/tier-${data.frameTier}.png`);
    const outer = tierFrameOuterSize(data.frameTier, size);
    ctx.drawImage(
      frame,
      WIDTH / 2 - outer / 2,
      by + size / 2 - outer / 2,
      outer,
      outer,
    );
  } catch {
    // border art unavailable — the bust alone still reads
  }

  // Name and rank.
  ctx.fillStyle = "#FFFFFF";
  ctx.font = '84px "Fredericka the Great"';
  ctx.fillText(data.displayName, WIDTH / 2, 722);
  ctx.fillStyle = tierColor;
  ctx.font = "800 34px Outfit, sans-serif";
  ctx.fillText(
    `${ladderTierName(data.frameTier).toUpperCase()}  ·  ${Number(data.ladderPoints).toLocaleString()} PTS`,
    WIDTH / 2,
    776,
  );

  // The brag.
  const hero = headline(data);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "800 28px Outfit, sans-serif";
  ctx.fillText(hero.label.split("").join(" "), WIDTH / 2, 878);
  ctx.fillStyle = GOLD;
  ctx.font = '138px "Fredericka the Great"';
  const heroWidth = ctx.measureText(hero.value).width;
  const heroX = hero.sol ? WIDTH / 2 - 46 : WIDTH / 2;
  ctx.fillText(hero.value, heroX, 1008);
  if (hero.sol) {
    // The official mark rides AFTER the amount — the unit sits on the right.
    ctx.save();
    ctx.translate(heroX + heroWidth / 2 + 42, 966 - 40);
    ctx.scale(0.78, 0.78);
    ctx.fillStyle = GOLD;
    ctx.fill(new Path2D(SOL_LOGO_PATH));
    ctx.restore();
  }

  // Supporting figures, small and on one line. The streak keeps the flame it
  // wears on the profile — the same fact should not look like two facts.
  const support: Array<{ glyph: string | null; text: string }> = [];
  if (data.bestPrizeRank > 0) {
    support.push({ glyph: null, text: `BEST #${data.bestPrizeRank}` });
  }
  if (data.entryStreakDays > 0) {
    support.push({ glyph: "flame", text: `${data.entryStreakDays} DAYS` });
  }
  support.push({ glyph: null, text: `★ ${data.totalStars}/300` });

  ctx.font = "700 32px ui-monospace, monospace";
  const gap = 46;
  const widths = support.map(
    (item) => ctx.measureText(item.text).width + (item.glyph ? 40 : 0),
  );
  let cursor =
    WIDTH / 2 -
    (widths.reduce((sum, w) => sum + w, 0) + gap * (support.length - 1)) / 2;
  ctx.textAlign = "left";
  support.forEach((item, index) => {
    if (item.glyph === "flame") {
      drawFlame(ctx, cursor + 14, 1094, 26);
      ctx.fillStyle = GOLD;
      ctx.fillText(item.text, cursor + 40, 1104);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.fillText(item.text, cursor, 1104);
    }
    cursor += widths[index]! + gap;
  });
  ctx.textAlign = "center";

  // The invitation. Everything above already says who is being challenged and
  // with what, so the line only has to point at them.
  const challenge = "CAN YOU BEAT ME?";
  ctx.font = "800 40px Outfit, sans-serif";
  const ctaWidth = Math.min(760, ctx.measureText(challenge).width + 92);
  roundedRect(ctx, WIDTH / 2 - ctaWidth / 2, 1160, ctaWidth, 96, 48);
  ctx.fillStyle = "rgba(250,204,21,0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(250,204,21,0.5)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.fillText(challenge, WIDTH / 2, 1222);

  await drawPlatformStrip(ctx, WIDTH / 2, 1300);

  return canvas.toDataURL("image/png");
}

/**
 * The profile share card: rendered to a canvas in the app's own furniture,
 * previewed in a sheet, then handed to the native share tray (or downloaded
 * where sharing files is unsupported).
 *
 * The preview is height-capped so the Share key is always on screen. A share
 * sheet whose share button sits below the fold is a share nobody completes.
 */
const ShareCardSheet: React.FC<ShareCardSheetProps> = ({
  open,
  onClose,
  data,
}) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setDataUrl(null);
    setError(null);
    drawCard(data)
      .then((url) => {
        if (!disposed) setDataUrl(url);
      })
      .catch(() => {
        if (!disposed) setError("The card could not be drawn. Try again.");
      });
    return () => {
      disposed = true;
    };
  }, [open, data]);

  const share = async () => {
    if (!dataUrl) return;
    setSharing(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "zkube-profile.png", {
        type: "image/png",
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = "zkube-profile.png";
        link.click();
      }
    } catch {
      // A dismissed share tray is not an error worth surfacing.
    } finally {
      setSharing(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} srTitle="Share your profile card">
      <div className="flex flex-col gap-3 pb-1">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Your zKube profile card"
            className="mx-auto max-h-[56vh] w-auto rounded-2xl"
          />
        ) : error ? (
          <p role="alert" className="py-10 text-center font-sans text-sm text-red-300">
            {error}
          </p>
        ) : (
          <p className="py-10 text-center font-sans text-sm font-semibold text-white/50">
            Drawing your card…
          </p>
        )}
        <button
          type="button"
          disabled={!dataUrl || sharing}
          onClick={() => void share()}
          className="w-full rounded-2xl px-4 py-3.5 font-sans text-[17px] font-extrabold uppercase tracking-[0.08em] text-[#241903] disabled:opacity-50"
          style={{
            background:
              "linear-gradient(160deg, #FCE177 0%, #FACC15 55%, #B4930F 100%)",
            boxShadow:
              "0 5px 0 #705C09, inset 0 2px 0 rgba(255,255,255,0.5)",
          }}
        >
          {sharing ? "Sharing…" : "Share"}
        </button>
      </div>
    </Sheet>
  );
};

export default ShareCardSheet;
