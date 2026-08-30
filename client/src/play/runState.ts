import type { ClientRunView } from "@/backend/client";

/** A move is valid only while the core projection owns a preview row. */
export function canSubmitRunMove(
  activeRun: Pick<
    ClientRunView,
    "lifecycle" | "nextRow" | "mode" | "deadlineAt"
  >,
  nowUnix = Math.floor(Date.now() / 1_000),
): boolean {
  const withinWindow =
    activeRun.mode === "campaign" ||
    activeRun.deadlineAt === undefined ||
    activeRun.deadlineAt <= 0 ||
    nowUnix < activeRun.deadlineAt;
  return (
    withinWindow &&
    activeRun.lifecycle === "playing" &&
    activeRun.nextRow !== null
  );
}
