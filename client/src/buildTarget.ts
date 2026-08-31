export const ZKUBE_BUILD_TARGETS = ["solana", "store", "playtest"] as const;
export type ZkubeBuildTarget = (typeof ZKUBE_BUILD_TARGETS)[number];

export function parseZkubeBuildTarget(
  value: string | undefined,
): ZkubeBuildTarget {
  const target = value ?? "solana";
  if ((ZKUBE_BUILD_TARGETS as readonly string[]).includes(target)) {
    return target as ZkubeBuildTarget;
  }
  throw new Error(`Unknown VITE_ZKUBE_BUILD target: ${target}`);
}

/** The only client-side read of the build variable. */
export const ZKUBE_BUILD_TARGET = (import.meta.env.VITE_ZKUBE_BUILD ??
  "solana") as ZkubeBuildTarget;
export const PLAYTEST_ACTIVE = ZKUBE_BUILD_TARGET === "playtest";
