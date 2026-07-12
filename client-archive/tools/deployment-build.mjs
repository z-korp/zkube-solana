import { spawnSync } from "node:child_process";

const production = process.env.VERCEL_ENV === "production"
  || process.env.ZKUBE_REQUIRE_APPROVED_DEPLOYMENT === "1";

if (production) {
  const manifest = required("ZKUBE_DEPLOYMENT_MANIFEST");
  const artifactSha256 = required("ZKUBE_PROGRAM_ARTIFACT_SHA256");
  run([
    "chain:manifest",
    "--",
    "--manifest",
    manifest,
    "--artifact-sha256",
    artifactSha256,
    "--require-approved",
    "--json",
  ]);
}

run(["build"]);

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    process.stderr.write(`${key} is required for an approved production deployment\n`);
    process.exit(2);
  }
  return value;
}

function run(args) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", env: process.env });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 2);
}
