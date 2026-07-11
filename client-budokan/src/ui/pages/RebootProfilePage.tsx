import { Award, Map, Star, Trophy } from "lucide-react";
import {
  getLevelFromXp,
  getTitleForLevel,
  ZONE_NAMES,
} from "@/config/profileData";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { useRebootProgress } from "@/solana/reboot/useRebootProgress";
import GameCard from "@/ui/components/shared/GameCard";
import PageHeader from "@/ui/components/shared/PageHeader";
import ProgressBar from "@/ui/components/shared/ProgressBar";
import ThemeBackground from "@/ui/components/shared/ThemeBackground";

export default function RebootProfilePage() {
  const identity = useEmbeddedIdentity();
  const campaign = useRebootCampaign();
  const rewards = useRebootProgress();
  const xp = Number(rewards.progress?.achievementXp ?? 0n);
  const level = getLevelFromXp(xp);
  const maps = campaign.campaign?.maps ?? [];
  const totalStars = maps.reduce(
    (sum, map) =>
      sum + map.levelStars.reduce((value, stars) => value + stars, 0),
    0,
  );
  const cleared = maps.filter((map) => map.cleared).length;

  return (
    <div className="relative min-h-full overflow-y-auto pb-28 pt-5 text-white">
      <ThemeBackground />
      <PageHeader title="Profile" />
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
        <GameCard variant="glass" className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-full border-4 border-cyan-300/40 bg-cyan-500/15 font-display text-3xl font-black text-cyan-200">
            {level}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-white/40">
              {identity.publicKey.toBase58()}
            </p>
            <h2 className="font-display text-2xl font-black">
              {getTitleForLevel(level)}
            </h2>
            <p className="mb-2 text-xs text-white/50">
              {xp.toLocaleString()} achievement XP
            </p>
            <ProgressBar
              value={Math.min(100, level)}
              max={100}
              color="#22d3ee"
              glow
            />
          </div>
        </GameCard>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            icon={<Star />}
            label="Spendable Stars"
            value={(campaign.campaign?.starsBalance ?? 0n).toString()}
            color="#facc15"
          />
          <Metric
            icon={<Trophy />}
            label="Level Stars"
            value={`${totalStars}/300`}
            color="#fb923c"
          />
          <Metric
            icon={<Map />}
            label="Maps cleared"
            value={`${cleared}/10`}
            color="#22d3ee"
          />
          <Metric
            icon={<Award />}
            label="Achievements"
            value={`${rewards.progress?.achievements.filter((entry) => entry.claimed).length ?? 0}/24`}
            color="#c084fc"
          />
        </div>

        <GameCard variant="glass">
          <h3 className="mb-3 font-display text-xl font-black">
            World progress
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 10 }, (_, index) => {
              const map = maps[index];
              const stars =
                map?.levelStars.reduce((sum, value) => sum + value, 0) ?? 0;
              return (
                <div
                  key={index}
                  className="rounded-xl border border-white/10 bg-black/25 p-3"
                >
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <strong>
                      {index + 1}. {ZONE_NAMES[index + 1]}
                    </strong>
                    <span className="text-yellow-300">{stars}/30 ★</span>
                  </div>
                  <ProgressBar
                    value={stars}
                    max={30}
                    color={map?.unlocked ? "#22d3ee" : "#64748b"}
                  />
                </div>
              );
            })}
          </div>
        </GameCard>

        <GameCard variant="glass">
          <h3 className="mb-3 font-display text-xl font-black">Achievements</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {rewards.progress?.achievements.map((entry) => (
              <div
                key={entry.index}
                className={`rounded-xl border p-3 ${entry.claimed ? "border-emerald-300/20 bg-emerald-500/10" : "border-white/10 bg-black/25"}`}
              >
                <div className="flex justify-between">
                  <strong>Achievement {entry.index + 1}</strong>
                  <span className="text-purple-300">{entry.xpReward} XP</span>
                </div>
                <p className="my-2 text-xs text-white/50">
                  {entry.progress.toString()} / {entry.threshold.toString()}
                </p>
                <ProgressBar
                  value={Number(
                    entry.progress > entry.threshold
                      ? entry.threshold
                      : entry.progress,
                  )}
                  max={Number(entry.threshold)}
                  color="#c084fc"
                />
                {entry.claimable && (
                  <button
                    onClick={() => void rewards.claimAchievement(entry.index)}
                    disabled={Boolean(rewards.claiming)}
                    className="mt-3 w-full rounded-lg bg-purple-500 px-3 py-2 text-xs font-black"
                  >
                    Claim XP
                  </button>
                )}
              </div>
            ))}
          </div>
        </GameCard>
        {(campaign.error || rewards.error) && (
          <p className="text-center text-xs text-red-300">
            {campaign.error ?? rewards.error}
          </p>
        )}
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <GameCard variant="glass" className="text-center">
      <span className="mx-auto mb-2 block w-fit" style={{ color }}>
        {icon}
      </span>
      <strong className="block text-2xl" style={{ color }}>
        {value}
      </strong>
      <span className="text-[10px] uppercase text-white/40">{label}</span>
    </GameCard>
  );
}
