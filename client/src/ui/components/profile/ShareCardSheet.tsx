import { useEffect, useState } from "react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import {
  GUARDIAN_FACE_CROPS,
  GUARDIAN_TIER_COLORS,
} from "@/config/guardianBlocks";
import { ladderTierColor, ladderTierName } from "@/config/ladderTiers";
import { getThemeId, getThemeImages } from "@/config/themes";
import { SOL_LOGO_PATH } from "@/ui/components/economy/SolMark";
import Sheet from "@/ui/components/shared/Sheet";
import { formatSolBalanceLamports } from "@/utils/currency";

const GOLD = "#FACC15";
const CREAM = "#FFF4D7";
const WIDTH = 1080;
const HEIGHT = 1350;

/** Per-tier opening fractions; mirrors TierFrame. */
const TIER_FRAME_OPENINGS = [0.8255, 0.6673, 0.7078, 0.5886, 0.6177];

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

  // The guardian block inside the border — the two things the player chose.
  const size = 356;
  const bx = WIDTH / 2 - size / 2;
  const by = 214;
  const body = ctx.createLinearGradient(bx, by, bx + size, by + size);
  body.addColorStop(0, "#FFFFFF");
  body.addColorStop(0.45, accent);
  body.addColorStop(1, "#10141E");
  roundedRect(ctx, bx, by, size, size, size * 0.24);
  ctx.fillStyle = body;
  ctx.fill();
  // A dark seat, not a white sticker: the border is the frame here.
  ctx.strokeStyle = "rgba(6,10,20,0.72)";
  ctx.lineWidth = 14;
  ctx.stroke();
  const inset = size * 0.085;
  roundedRect(
    ctx,
    bx + inset,
    by + inset,
    size - inset * 2,
    size - inset * 2,
    size * 0.2,
  );
  ctx.save();
  ctx.clip();
  try {
    const img = await loadImage(getGuardianPortrait(zoneId));
    const [sx, sy, side] = faceCrop(zoneId);
    ctx.filter = "brightness(1.3) saturate(1.25)";
    ctx.drawImage(
      img,
      sx,
      sy,
      side,
      side,
      bx + inset,
      by + inset,
      size - inset * 2,
      size - inset * 2,
    );
    ctx.filter = "none";
  } catch {
    // face art unavailable — the block alone still reads
  }
  const gloss = ctx.createLinearGradient(0, by, 0, by + size * 0.4);
  gloss.addColorStop(0, "rgba(255,255,255,0.35)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(bx + inset, by + inset, size - inset * 2, size * 0.34);
  ctx.restore();
  try {
    const frame = await loadImage(`/assets/common/tier-${data.frameTier}.png`);
    const outer = (size * 1.03) / (TIER_FRAME_OPENINGS[data.frameTier] ?? 0.8255);
    ctx.drawImage(
      frame,
      WIDTH / 2 - outer / 2,
      by + size / 2 - outer / 2,
      outer,
      outer,
    );
  } catch {
    // border art unavailable — the block alone still reads
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

  // Supporting figures, small and on one line.
  const support = [
    data.bestPrizeRank > 0 ? `BEST #${data.bestPrizeRank}` : null,
    data.entryStreakDays > 0 ? `${data.entryStreakDays}-DAY STREAK` : null,
    `★ ${data.totalStars}/300`,
  ].filter(Boolean) as string[];
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "700 32px ui-monospace, monospace";
  ctx.fillText(support.join("   ·   "), WIDTH / 2, 1104);

  // The invitation.
  roundedRect(ctx, WIDTH / 2 - 330, 1172, 660, 94, 47);
  ctx.fillStyle = "rgba(250,204,21,0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(250,204,21,0.5)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.font = "800 38px Outfit, sans-serif";
  ctx.fillText("BEAT ME ON TODAY'S DAILY", WIDTH / 2, 1232);

  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "700 26px Outfit, sans-serif";
  ctx.fillText(
    `${getZoneGuardian(zoneId).name}'s realm · Solana`,
    WIDTH / 2,
    1308,
  );

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
