import { keeperReleaseRecord } from "./keeperRelease.js";

const [
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageDigest,
  replayDomainHex,
  rulesHash,
  schemaHash,
  idlHash,
  rawRulesVersion,
] = process.argv.slice(2);
const rulesVersion = Number(rawRulesVersion);

if (!programId || !keeperPublicKey || !deployedProgramDataSha256 ||
    !keeperImageDigest || !replayDomainHex || !rulesHash || !schemaHash ||
    !idlHash || !Number.isSafeInteger(rulesVersion)) {
  throw new Error(
    "usage: keeperReleaseCli <program-id> <keeper-public-key> " +
      "<deployed-programdata-sha256> <keeper-image-sha256:digest> " +
      "<replay-domain-hex> <rules-hash> <schema-hash> <idl-hash> " +
      "<rules-version>",
  );
}

process.stdout.write(`${JSON.stringify(keeperReleaseRecord({
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageDigest,
  replayDomainHex,
  rulesHash,
  schemaHash,
  idlHash,
  rulesVersion,
}), null, 2)}\n`);
