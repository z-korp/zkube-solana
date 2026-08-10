import type { CompetitionRecord, PlayerStateView } from "./campaignClient.js";

/** The two Daily boards, matching `competitionProfileSynced.board`. */
export type PeriodKind = 0 | 1;

export type PeriodLabel = "Score" | "Theme";

export const PERIOD_LABELS: Record<PeriodKind, PeriodLabel> = {
  0: "Score",
  1: "Theme",
};

const PERIOD_KINDS: readonly PeriodKind[] = [0, 1];

/**
 * A single, precise profile-prize signal: one Daily board's competition
 * record whose lifetime `rewardsLamports` grew between two confirmed PlayerState
 * snapshots. This is durable awarded-prize metadata, independent of whether the
 * owner has submitted the corresponding claim.
 */
export interface SettlementEvent {
  periodKind: PeriodKind;
  label: PeriodLabel;
  /** How much this period's lifetime rewards grew across the two snapshots. */
  deltaLamports: bigint;
  /** The new lifetime rewards total for this period after the increase. */
  newTotalLamports: bigint;
  /**
   * Best payout-bearing rank on the period record after this increase (0 = none).
   *
   * This is the LIFETIME-best rank carried on PlayerState, which equals this
   * placement only on a player's first prize for the period; a repeat winner who
   * previously placed higher keeps that better rank here. The exact per-event
   * rank lives only in the `competitionProfileSynced` program event
   * ({ owner, board, rank:u16, rewardLamports:u64}); we deliberately do not
   * scrape program logs for it (no existing log-decode surface in the client, and
   * flaky signature scraping is explicitly out of scope). Treat this as the honest
   * best-known rank, not a claim about this specific win.
   */
  bestPrizeRank: number;
}

export function periodRecord(
  view: PlayerStateView,
  kind: PeriodKind,
): CompetitionRecord {
  return kind === 0 ? view.scoreRecord : view.themeRecord;
}

/**
 * Diff two decoded PlayerState snapshots and return one event per period whose
 * rewards increased. When `previous` is null (the first observation for a wallet)
 * this returns [] so a returning player with existing winnings is baselined
 * silently rather than falsely congratulated. One entry places on both boards, so
 * a single keeper settlement burst can pay both and callers must be ready for
 * more than one event.
 */
export function detectSettlementEvents(
  previous: PlayerStateView | null,
  next: PlayerStateView,
): SettlementEvent[] {
  if (!previous) return [];
  const events: SettlementEvent[] = [];
  for (const kind of PERIOD_KINDS) {
    const before = periodRecord(previous, kind).rewardsLamports;
    const after = periodRecord(next, kind);
    if (after.rewardsLamports > before) {
      events.push({
        periodKind: kind,
        label: PERIOD_LABELS[kind],
        deltaLamports: after.rewardsLamports - before,
        newTotalLamports: after.rewardsLamports,
        bestPrizeRank: after.bestPrizeRank,
      });
    }
  }
  return events;
}

/**
 * The most significant event in a burst. Used to surface a single latest
 * awarded prize while callers still reconcile every record.
 */
export function pickPrimaryEvent(
  events: readonly SettlementEvent[],
): SettlementEvent | null {
  let best: SettlementEvent | null = null;
  for (const event of events) {
    if (
      best === null ||
      event.deltaLamports > best.deltaLamports ||
      (event.deltaLamports === best.deltaLamports &&
        event.periodKind < best.periodKind)
    ) {
      best = event;
    }
  }
  return best;
}
