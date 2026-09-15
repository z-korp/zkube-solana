import { useState, type ReactNode } from "react";
import { Flame, Share2 } from "lucide-react";

import { getGuardianPortrait } from "@/config/bossCharacters";
import Sheet from "@/ui/components/shared/Sheet";
import { shareCardText } from "./shareCardText";

export interface ShareCardData {
  readonly displayName: string;
  readonly realm: string;
  readonly objective: string;
  readonly dailyScore: number;
  readonly objectiveTotal: bigint;
  readonly streak: number;
  readonly guardianName: string;
  readonly guardianGreeting: string;
  readonly zoneId: number;
}

interface ShareCardSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly data: ShareCardData;
  readonly closeDisabled?: boolean;
  readonly saveError?: string | null;
  readonly onRetry?: () => void;
}

export default function ShareCardSheet({
  open,
  onClose,
  data,
  closeDisabled = false,
  saveError = null,
  onRetry,
}: ShareCardSheetProps) {
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const shareText = shareCardText(data);

  const share = async () => {
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: "zKube Daily", text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
      }
      setShared(true);
    } catch {
      // Closing the native share tray leaves the result card unchanged.
    } finally {
      setSharing(false);
    }
  };

  return (
    <Sheet open={open} onClose={closeDisabled ? () => undefined : onClose}>
      <div className="overflow-hidden rounded-3xl bg-[#07101f] text-white shadow-2xl">
        <div className="relative h-52 overflow-hidden bg-[radial-gradient(circle_at_top,#245173,#07101f_70%)]">
          <img
            src={getGuardianPortrait(data.zoneId)}
            alt={data.guardianName}
            className="absolute inset-x-0 bottom-0 mx-auto h-[92%] w-auto object-contain"
            draggable={false}
          />
          <span className="absolute left-4 top-4 font-display text-3xl text-[#FFF4D7]">
            zKube
          </span>
        </div>
        <div className="p-5 text-center">
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/60">
            {data.realm} · {data.objective}
          </p>
          <h2 className="mt-1 font-display text-3xl text-[#FFF4D7]">
            {data.displayName}
          </h2>
          <p className="mt-2 font-sans text-sm italic leading-6 text-white/65">
            “{data.guardianGreeting}”
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Result label="Score" value={data.dailyScore.toLocaleString()} />
            <Result label="Theme" value={data.objectiveTotal.toString()} />
            <Result
              label="Streak"
              value={data.streak.toString()}
              icon={<Flame size={13} />}
            />
          </div>
          {saveError && (
            <p role="alert" className="mt-3 font-sans text-xs text-red-300">
              {saveError}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={sharing}
              onClick={() => void share()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-200/15 px-4 py-3 font-sans text-sm font-black text-cyan-100 disabled:opacity-40"
            >
              <Share2 size={15} />
              {sharing ? "Opening…" : shared ? "Shared" : "Share"}
            </button>
            <button
              type="button"
              disabled={closeDisabled && !saveError}
              onClick={saveError ? onRetry : onClose}
              className="rounded-xl bg-amber-300 px-4 py-3 font-sans text-sm font-black text-slate-950 disabled:opacity-40"
            >
              {saveError ? "Try again" : closeDisabled ? "Saving…" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function Result({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white/[0.06] px-2 py-3">
      <p className="flex items-center justify-center gap-1 font-mono text-lg font-black text-cyan-100">
        {icon}
        {value}
      </p>
      <p className="font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">
        {label}
      </p>
    </div>
  );
}
