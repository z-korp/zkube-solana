export type ChainMetricLayer =
  | "solana-base"
  | "router"
  | "magicblock-er"
  | "vrf"
  | "orchestration";

export interface ChainMetric {
  schemaVersion: 1;
  event: "run_metric";
  traceId: string;
  operation: string;
  layer: ChainMetricLayer;
  phase: string;
  ok: boolean;
  durationMs?: number;
  signature?: string;
  slot?: number;
  endpointHost?: string;
  runId?: string;
  unitsConsumed?: number;
  feeLamports?: number;
  rentCreatedLamports?: number;
  rentRefundedLamports?: number;
  balanceAfterLamports?: number;
  [key: string]: unknown;
}

export function createChainTraceId(): string {
  return crypto.randomUUID();
}

export function emitChainMetric(metric: Omit<ChainMetric, "schemaVersion" | "event">): void {
  const mode = (import.meta.env.VITE_PUBLIC_ZKUBE_TELEMETRY ?? "console").trim();
  if (mode === "off") return;
  console.info(JSON.stringify({ schemaVersion: 1, event: "run_metric", ...metric }));
}
