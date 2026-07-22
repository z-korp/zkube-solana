import { keeperReleaseRecord } from "./keeperRelease.js";

const [
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageDigest,
  replayDomainHex,
  rulesCatalogHash,
  idlHash,
  rawRulesVersion,
  rawLaunchDayId,
] = process.argv.slice(2);
const rulesVersion = Number(rawRulesVersion);
const launchDayId = Number(rawLaunchDayId);

if (!programId || !keeperPublicKey || !deployedProgramDataSha256 ||
    !keeperImageDigest || !replayDomainHex || !rulesCatalogHash ||
    !idlHash || !Number.isSafeInteger(rulesVersion) ||
    !Number.isSafeInteger(launchDayId)) {
  throw new Error(
    "usage: keeperReleaseCli <program-id> <keeper-public-key> " +
      "<deployed-programdata-sha256> <keeper-image-sha256:digest> " +
      "<replay-domain-hex> <rules-catalog-hash> <idl-hash> " +
      "<rules-version> <launch-day-id>",
  );
}

process.stdout.write(`${JSON.stringify(keeperReleaseRecord({
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageDigest,
  replayDomainHex,
  rulesCatalogHash,
  idlHash,
  rulesVersion,
  launchDayId,
}), null, 2)}\n`);
