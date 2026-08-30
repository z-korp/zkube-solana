import { keeperReleaseRecord } from "./keeperRelease.js";

const [
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageReference,
  idlHash,
  rawLaunchDayId,
] = process.argv.slice(2);
const launchDayId = Number(rawLaunchDayId);

if (!programId || !keeperPublicKey || !deployedProgramDataSha256 ||
    !keeperImageReference || !idlHash ||
    !Number.isSafeInteger(launchDayId)) {
  throw new Error(
    "usage: keeperReleaseCli <program-id> <keeper-public-key> " +
      "<deployed-programdata-sha256> <keeper-image-reference> " +
      "<idl-hash> <launch-day-id>",
  );
}

process.stdout.write(`${JSON.stringify(keeperReleaseRecord({
  programId,
  keeperPublicKey,
  deployedProgramDataSha256,
  keeperImageReference,
  idlHash,
  launchDayId,
}), null, 2)}\n`);
