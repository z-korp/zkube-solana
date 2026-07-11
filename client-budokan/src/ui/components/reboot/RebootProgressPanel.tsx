import { ACHIEVEMENT_DEFS } from "@/config/achievementDefs";
import { QUEST_DEFS } from "@/config/questDefs";
import { useRebootProgress } from "@/solana/reboot/useRebootProgress";

export default function RebootProgressPanel({ expanded = false }: { expanded?: boolean }) {
  const { progress, loading, claiming, error, claimAchievement, claimQuest } = useRebootProgress();
  if (loading && !progress) return <p className="text-xs text-white/40">Loading on-chain progress…</p>;
  if (!progress) {
    return <p className="max-w-xs text-center text-xs text-white/40">
      {error ?? "Progress rewards activate when governance publishes the first catalog."}
    </p>;
  }
  const achievements = progress.achievements.filter((entry) => expanded ? !entry.claimed : entry.claimable);
  const quests = progress.quests.filter((entry) => expanded
    ? entry.active && !entry.claimed
    : entry.claimable);
  return <div className="flex w-full flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/60">Stars</span>
      <strong className="text-yellow-300">{progress.starsBalance.toString()} ★</strong>
    </div>
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/60">Achievement XP</span>
      <strong className="text-cyan-300">{progress.achievementXp.toString()} XP</strong>
    </div>
    {achievements.length > 0 && <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-white/35">Achievements</p>}
    {achievements.map((entry) => <RewardButton
      key={`achievement:${entry.index}`}
      label={ACHIEVEMENT_DEFS[entry.index]?.name ?? `Achievement ${entry.index + 1}`}
      progress={entry.progress}
      threshold={entry.threshold}
      claimable={entry.claimable}
      starReward={entry.starReward}
      xpReward={entry.xpReward}
      busy={claiming === `achievement:${entry.index}`}
      onClick={() => claimAction(claimAchievement(entry.index))}
    />)}
    {quests.length > 0 && <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-white/35">Active quests</p>}
    {quests.map((entry) => <RewardButton
      key={`quest:${entry.index}`}
      label={QUEST_DEFS[entry.index]?.name ?? `Quest ${entry.index + 1}`}
      progress={BigInt(entry.progress)}
      threshold={BigInt(entry.threshold)}
      claimable={entry.claimable}
      starReward={entry.starReward}
      busy={claiming === `quest:${entry.index}`}
      onClick={() => claimAction(claimQuest(entry.index))}
    />)}
    {achievements.length === 0 && quests.length === 0 && (
      <p className="text-center text-[11px] text-white/40">No progress rewards ready to claim.</p>
    )}
    {error && <p className="text-center text-[11px] text-red-300">{error}</p>}
  </div>;
}

function RewardButton(props: {
  label: string;
  progress: bigint;
  threshold: bigint;
  claimable: boolean;
  starReward: bigint;
  xpReward?: number;
  busy: boolean;
  onClick: () => void;
}) {
  return <button
    type="button"
    disabled={props.busy || !props.claimable}
    onClick={props.onClick}
    className="flex items-center justify-between rounded-lg bg-yellow-500/15 px-3 py-2 text-left text-xs text-white hover:bg-yellow-500/25 disabled:opacity-50"
  >
    <span>
      <span className="block">{props.label}</span>
      <span className="text-[10px] text-white/35">{props.progress.toString()}/{props.threshold.toString()}</span>
    </span>
    <span className="text-right">
      <strong className={`block ${props.xpReward ? "text-cyan-300" : "text-yellow-300"}`}>
        {[
          props.xpReward ? `+${props.xpReward} XP` : null,
          props.starReward > 0n ? `+${props.starReward} ★` : null,
        ].filter(Boolean).join(" · ")}
      </strong>
      <span className="text-[10px] text-white/35">
        {props.busy ? "Claiming…" : props.claimable ? "Ready to claim" : "In progress"}
      </span>
    </span>
  </button>;
}

function claimAction(action: Promise<unknown>): void {
  void action.catch(() => {
    // Hook state already contains the user-facing error.
  });
}
