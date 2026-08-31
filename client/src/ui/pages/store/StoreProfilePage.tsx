import { Flame, Star } from "lucide-react";

import { useConnectedPlayer } from "@/backend/client";
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import GuardianFaceBlock from "@/ui/components/economy/GuardianFaceBlock";

export default function StoreProfilePage() {
  const player = useConnectedPlayer();
  const profile = usePlayerProfile();
  const emblem = Math.min(10, Math.max(1, profile.featuredEmblem || 1));

  return (
    <div className="relative flex min-h-full flex-col gap-3 px-4 pb-6 pt-7 text-white">
      <h1 className="text-center font-display text-[36px] leading-none text-[#FFF4D7]">
        Profile
      </h1>
      <section className="mt-3 rounded-3xl border border-white/10 bg-[#101a2b] p-5 text-center shadow-2xl">
        <GuardianFaceBlock zoneId={emblem} size={96} className="mx-auto" />
        <p className="mt-3 font-display text-2xl">
          {player.publicKey ? "Local Player" : "Player"}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat
            icon={<Star size={15} />}
            label="Stars"
            value={profile.totalStars}
          />
          <Stat
            icon={<Flame size={15} />}
            label="Streak"
            value={profile.entryStreakDays}
          />
          <Stat label="Best" value={profile.bestDailyScore} />
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl bg-black/30 px-2 py-3">
      <span className="flex items-center justify-center gap-1 font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
        {icon}
        {label}
      </span>
      <strong className="mt-1 block font-mono text-lg">{value}</strong>
    </div>
  );
}
