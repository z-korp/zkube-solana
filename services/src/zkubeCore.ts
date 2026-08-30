// The generated Node target and the browser package come from the same Rust
// source and are freshness-checked together. Brief 08 moves protocol consumers
// onto these exports; keeping the import in production source proves the keeper
// build can load the artifact before those deletions land.
export {
  applyRunBonus,
  applyRunVrf,
  boardWidth,
  dailyBoardPools,
  dailyPairIndex,
  finishRun,
  initializeRun,
  payoutForRank,
  payoutPlan,
  playRunMove,
  requestRunReroll,
  runEndReason,
  runLatchedStarSources,
  runScoreEligible,
} from "../zkube-core/zkube_core.js";
