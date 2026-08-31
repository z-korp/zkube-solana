import { Flame, Star } from "lucide-react";

import {
  useCampaign,
  useCampaignUnlock,
  useConnectedPlayer,
  useIdentityActions,
} from "@/backend/client";
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import GuardianFaceBlock from "@/ui/components/economy/GuardianFaceBlock";

export default function StoreProfilePage() {
  const player = useConnectedPlayer();
  const campaign = useCampaign();
  const identity = useIdentityActions();
  const campaignUnlock = useCampaignUnlock();
  const profile = usePlayerProfile();
  const emblem = Math.min(10, Math.max(1, profile.featuredEmblem || 1));
  const earnedGuardians =
    campaign.campaign?.maps.filter((map) => map.cleared) ?? [];

  return (
    <div className="relative flex min-h-full flex-col gap-3 px-4 pb-6 pt-7 text-white">
      <h1 className="text-center font-display text-[36px] leading-none text-[#FFF4D7]">
        Profile
      </h1>
      <section className="mt-3 rounded-3xl border border-white/10 bg-[#101a2b] p-5 text-center shadow-2xl">
        <GuardianFaceBlock zoneId={emblem} size={96} className="mx-auto" />
        <p className="mt-3 font-display text-2xl">{player.label ?? "Player"}</p>
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
      {earnedGuardians.length > 0 && (
        <section className="rounded-3xl bg-[#101a2b] p-4">
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
            Guardian emblem
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {earnedGuardians.map((map) => (
              <button
                key={map.mapId}
                type="button"
                aria-label={`Wear guardian ${map.mapId}`}
                aria-pressed={profile.featuredEmblem === map.mapId}
                onClick={() => void identity.setWorn(map.mapId, 0)}
                className="rounded-2xl p-1.5 aria-pressed:bg-cyan-200/20"
              >
                <GuardianFaceBlock zoneId={map.mapId} size={54} />
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="rounded-3xl bg-[#101a2b] p-4 text-center">
        <button
          type="button"
          disabled={campaignUnlock.busy}
          onClick={() => {
            void campaignUnlock.restorePurchases().catch(() => undefined);
          }}
          className="rounded-xl border border-white/15 px-4 py-2 font-sans text-sm font-bold text-white disabled:opacity-50"
        >
          Restore purchases
        </button>
        {campaignUnlock.error && (
          <p className="mt-2 font-sans text-xs text-red-200">
            {campaignUnlock.error}
          </p>
        )}
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
