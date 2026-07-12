import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deploymentManifestFromEnv,
  formatDeploymentManifestValidation,
  isZkubeDeploymentManifest,
  validateDeploymentBinding,
  validateDeploymentManifest,
} from "../../src/chain/deploymentManifest";

interface Options {
  manifestPath: string | null;
  fromEnv: boolean;
  artifactPath: string | null;
  artifactSha256: string | null;
  requireApproved: boolean;
  json: boolean;
}

function main(): void {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write([
      "Usage:",
      "  pnpm chain:manifest -- --manifest <FILE> [options]",
      "  pnpm chain:manifest -- --from-env [options]",
      "",
      "Options:",
      "  --artifact <FILE>     SBF to hash (default when no hash is supplied)",
      "  --artifact-sha256 <HASH>  Precomputed SBF hash for artifact-less web builds",
      "  --require-approved    Reject candidate manifests",
      "  --json                Emit machine-readable JSON",
      "",
      "Read-only: reads configuration and the local SBF; no RPC, signer, or transaction path.",
      "Generated manifests are written only to stdout.",
      "",
    ].join("\n"));
    return;
  }
  const options = parseOptions(process.argv.slice(2));
  const manifest = options.fromEnv
    ? deploymentManifestFromEnv(process.env)
    : readManifest(options.manifestPath!);
  const artifactPath = options.artifactPath
    ? resolve(process.cwd(), options.artifactPath)
    : null;
  const artifactSha256 = options.artifactSha256 ?? createHash("sha256")
    .update(readFileSync(artifactPath!))
    .digest("hex");
  const binding = validateDeploymentBinding({
    manifest,
    artifactSha256,
    env: process.env,
    requireApproved: options.requireApproved,
  });
  if (options.json || options.fromEnv) {
    process.stdout.write(`${JSON.stringify({
      manifest,
      artifactPath,
      artifactSha256,
      binding,
    }, null, 2)}\n`);
  } else {
    process.stdout.write([
      formatDeploymentManifestValidation(binding.manifest),
      `[${binding.artifactMatches ? "pass" : "fail"}] Artifact SHA-256: ${artifactSha256}`,
      `[${binding.approvalSatisfied ? "pass" : "fail"}] Approval: ${manifest.approval.status}`,
      ...binding.environmentMismatches.map((mismatch) => `[fail] Environment: ${mismatch}`),
      `Bound: ${binding.valid ? "yes" : "no"}`,
      "",
    ].join("\n"));
  }
  if (!binding.valid) process.exitCode = 2;
}

function parseOptions(argv: string[]): Options {
  const manifestPath = option(argv, "--manifest") ?? null;
  const fromEnv = argv.includes("--from-env");
  if (fromEnv === Boolean(manifestPath)) {
    throw new Error("Specify exactly one of --manifest or --from-env");
  }
  const knownFlags = new Set([
    "--manifest",
    "--from-env",
    "--artifact",
    "--artifact-sha256",
    "--require-approved",
    "--json",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value?.startsWith("--") && !knownFlags.has(value)) {
      throw new Error(`Unknown option ${value}`);
    }
    if (value === "--manifest" || value === "--artifact" || value === "--artifact-sha256") {
      index += 1;
    }
  }
  const explicitArtifact = option(argv, "--artifact");
  const artifactSha256 = option(argv, "--artifact-sha256") ?? null;
  if (explicitArtifact && artifactSha256) {
    throw new Error("Specify only one of --artifact or --artifact-sha256");
  }
  return {
    manifestPath,
    fromEnv,
    artifactPath: artifactSha256
      ? null
      : explicitArtifact ?? "../solana/target/deploy/solana.so",
    artifactSha256,
    requireApproved: argv.includes("--require-approved"),
    json: argv.includes("--json"),
  };
}

function readManifest(path: string): ReturnType<typeof deploymentManifestFromEnv> {
  const raw = readFileSync(resolve(process.cwd(), path));
  if (raw.byteLength > 256 * 1_024) throw new Error("Deployment manifest exceeds 256 KiB");
  let source: unknown;
  try {
    source = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("Deployment manifest is not valid JSON");
  }
  if (!isZkubeDeploymentManifest(source)) {
    const validation = validateDeploymentManifest(source);
    throw new Error(`Deployment manifest is invalid: ${validation.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.id}: ${check.detail}`)
      .join("; ")}`);
  }
  return source;
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

main();
