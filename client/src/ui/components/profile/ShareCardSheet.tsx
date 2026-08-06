import { useEffect, useState } from "react";

import type { CompetitionRecord } from "@/chain/campaignClient";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import {
  GUARDIAN_FACE_CROPS,
  GUARDIAN_TIER_COLORS,
} from "@/config/guardianBlocks";
import { SOL_LOGO_PATH } from "@/ui/components/economy/SolMark";
import Sheet from "@/ui/components/shared/Sheet";
import { formatSolBalanceLamports } from "@/utils/currency";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const GOLD = "#FACC15";
const CREAM = "#FFF4D7";

export interface ShareCardData {
  displayName: string;
  address: string;
  /** Featured emblem id; guardian faces render for 1..10, a star otherwise. */
  featuredEmblem: number;
  totalStars: number;
  totalEarnedLamports: bigint;
  records: Array<{ label: string; record: CompetitionRecord }>;
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

async function drawCard(data: ShareCardData): Promise<string> {
  await document.fonts.load('80px "Fredericka the Great"').catch(() => []);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("share card: no canvas context");

  // Ground + panel.
  ctx.fillStyle = "#070C18";
  ctx.fillRect(0, 0, 1080, 1350);
  const panel = ctx.createLinearGradient(0, 90, 0, 1260);
  panel.addColorStop(0, "#131F35");
  panel.addColorStop(1, "#0D1626");
  roundedRect(ctx, 60, 90, 960, 1170, 48);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = "center";

  // The app title.
  ctx.fillStyle = CREAM;
  ctx.font = '96px "Fredericka the Great"';
  ctx.fillText("zKube", 540, 230);

  // The emblem block.
  const size = 300;
  const bx = 540 - size / 2;
  const by = 290;
  const zoneId =
    data.featuredEmblem >= 1 && data.featuredEmblem <= 10
      ? data.featuredEmblem
      : null;
  const base = zoneId ? GUARDIAN_TIER_COLORS[zoneId] : "#4E7BE0";
  const body = ctx.createLinearGradient(bx, by, bx + size, by + size);
  body.addColorStop(0, "#FFFFFF");
  body.addColorStop(0.45, base);
  body.addColorStop(1, "#10141E");
  roundedRect(ctx, bx, by, size, size, size * 0.24);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 12;
  ctx.stroke();
  if (zoneId) {
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
      // face art unavailable — the tier block alone still reads
    }
    const gloss = ctx.createLinearGradient(0, by, 0, by + size * 0.4);
    gloss.addColorStop(0, "rgba(255,255,255,0.35)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.fillRect(bx + inset, by + inset, size - inset * 2, size * 0.34);
    ctx.restore();
  } else {
    ctx.fillStyle = GOLD;
    ctx.font = "150px sans-serif";
    ctx.fillText("★", 540, by + size * 0.66);
  }

  // Name + wallet.
  ctx.fillStyle = "#FFFFFF";
  ctx.font = '84px "Fredericka the Great"';
  ctx.fillText(data.displayName, 540, 710);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "600 30px ui-monospace, monospace";
  ctx.fillText(truncatePublicKey(data.address), 540, 760);

  // Total earned.
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "700 26px Outfit, sans-serif";
  ctx.fillText("T O T A L   E A R N E D", 540, 840);
  const amount = formatSolBalanceLamports(data.totalEarnedLamports);
  ctx.fillStyle = GOLD;
  ctx.font = '110px "Fredericka the Great"';
  const amountWidth = ctx.measureText(amount).width;
  ctx.fillText(amount, 540 - 40, 950);
  // The official mark rides AFTER the amount — the unit sits on the right.
  ctx.save();
  ctx.translate(540 - 40 + amountWidth / 2 + 30, 915 - 32);
  ctx.scale(0.62, 0.62);
  ctx.fillStyle = GOLD;
  ctx.fill(new Path2D(SOL_LOGO_PATH));
  ctx.restore();

  // Records.
  ctx.font = "700 34px ui-monospace, monospace";
  const parts = data.records.map(({ label, record }) =>
    record.bestPrizeRank > 0 ? `${label} #${record.bestPrizeRank}` : `${label} —`,
  );
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(parts.join("   ·   "), 540, 1060);

  // Stars.
  ctx.fillStyle = GOLD;
  ctx.font = "700 40px ui-monospace, monospace";
  ctx.fillText(`★ ${data.totalStars}/300`, 540, 1140);

  // Footer.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "700 26px Outfit, sans-serif";
  ctx.fillText(
    data.featuredEmblem >= 1 && data.featuredEmblem <= 10
      ? `${getZoneGuardian(data.featuredEmblem).name} rides with me`
      : "Solana arcade",
    540,
    1215,
  );

  return canvas.toDataURL("image/png");
}

/**
 * The profile share card: rendered to a canvas in the app's own furniture,
 * previewed in a sheet, then handed to the native share tray (or downloaded
 * where sharing files is unsupported).
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
    <Sheet open={open} onClose={onClose} title="Share card">
      <div className="flex flex-col gap-3 pb-2">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Your zKube profile card"
            className="w-full rounded-2xl border border-white/[0.12]"
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
