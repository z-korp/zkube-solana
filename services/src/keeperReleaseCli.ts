import { keeperReleaseRecord } from "./keeperRelease.js";

const [
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageReference,
  replayDomainHex,
  idlHash,
  rawLaunchDayId,
  keeperImageDigest,
] = process.argv.slice(2);
const launchDayId = Number(rawLaunchDayId);

if (!programId || !keeperPublicKey || !deployedProgramDataSha256 ||
    !keeperImageReference || !replayDomainHex || !idlHash ||
    !Number.isSafeInteger(launchDayId)) {
  throw new Error(
    "usage: keeperReleaseCli <program-id> <keeper-public-key> " +
      "<deployed-programdata-sha256> <keeper-image-reference> " +
      "<replay-domain-hex> <idl-hash> <launch-day-id> " +
      "[keeper-image-sha256:digest]",
  );
}

process.stdout.write(`${JSON.stringify(keeperReleaseRecord({
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageReference,
  ...(keeperImageDigest === undefined ? {} : { keeperImageDigest }),
  replayDomainHex,
  idlHash,
  launchDayId,
}), null, 2)}\n`);
