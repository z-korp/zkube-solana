import { CalendarDays, Check, Clock, Star } from "lucide-react";
import { QUEST_DEFS } from "@/config/questDefs";
import { useRebootProgress } from "@/solana/reboot/useRebootProgress";
import GameCard from "@/ui/components/shared/GameCard";
import PageHeader from "@/ui/components/shared/PageHeader";
import ProgressBar from "@/ui/components/shared/ProgressBar";
import ThemeBackground from "@/ui/components/shared/ThemeBackground";

export default function RebootRewardsPage() {
  const rewards = useRebootProgress();
  const active = rewards.progress?.quests.filter((quest) => quest.active) ?? [];
  return (
    <div className="relative min-h-full overflow-y-auto pb-28 pt-5 text-white">
      <ThemeBackground />
      <PageHeader title="Rewards" />
      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-col gap-4 px-4">
        <GameCard variant="glass" className="text-center">
          <Star className="mx-auto text-yellow-300" fill="currentColor" />
          <strong className="mt-2 block font-display text-4xl text-yellow-200">
            {rewards.progress?.starsBalance.toString() ?? "0"}
          </strong>
          <span className="text-xs uppercase tracking-widest text-white/45">
            Spendable Stars
          </span>
          <p className="mt-3 text-sm text-white/55">
            Complete three rotating Daily quests for 1 Star each and claim the
            +2 finisher. Weekly quests award 5 Stars each.
          </p>
        </GameCard>
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((quest) => (
            <GameCard
              key={quest.index}
              variant="glass"
              className={quest.claimed ? "opacity-60" : ""}
            >
              <div className="flex items-start justify-between">
                <span
                  className={`rounded-xl p-2 ${quest.cadence === "daily" ? "bg-cyan-500/15 text-cyan-300" : "bg-purple-500/15 text-purple-300"}`}
                >
                  {quest.cadence === "daily" ? <Clock /> : <CalendarDays />}
                </span>
                <span className="flex items-center gap-1 font-black text-yellow-300">
                  +{quest.starReward.toString()}{" "}
                  <Star size={13} fill="currentColor" />
                </span>
              </div>
              <h2 className="mt-3 font-display text-lg font-black">
                {QUEST_DEFS[quest.index]
                  ? `${QUEST_DEFS[quest.index].icon} ${QUEST_DEFS[quest.index].name}`
                  : `${quest.cadence === "daily" ? "Daily" : "Weekly"} quest ${quest.index + 1}`}
              </h2>
              {quest.cadence === "daily" && quest.starReward === 2n && (
                <p className="text-[10px] font-black uppercase tracking-widest text-yellow-300">
                  Daily finisher — claim all three dailies first
                </p>
              )}
              <p className="my-2 text-xs text-white/50">
                {QUEST_DEFS[quest.index]?.description ?? ""}
                {" · "}
                {quest.progress} / {quest.threshold}
              </p>
              <ProgressBar
                value={Math.min(quest.progress, quest.threshold)}
                max={quest.threshold}
                color={quest.cadence === "daily" ? "#22d3ee" : "#c084fc"}
                glow
              />
              {quest.claimed ? (
                <p className="mt-3 flex items-center justify-center gap-1 text-xs text-emerald-300">
                  <Check size={14} /> Claimed
                </p>
              ) : (
                <button
                  disabled={!quest.claimable || Boolean(rewards.claiming)}
                  onClick={() => void rewards.claimQuest(quest.index)}
                  className="mt-3 w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-30"
                >
                  {rewards.claiming === `quest:${quest.index}`
                    ? "Claiming…"
                    : "Claim Stars"}
                </button>
              )}
            </GameCard>
          ))}
        </div>
        {rewards.loading && (
          <p className="animate-pulse text-center text-white/50">
            Loading on-chain quests…
          </p>
        )}
        {rewards.error && (
          <p className="text-center text-xs text-red-300">{rewards.error}</p>
        )}
      </main>
    </div>
  );
}
