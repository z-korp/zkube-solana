import { keeperReleaseRecord } from "./keeperRelease.js";

const hash = process.argv[2];
const image = process.argv[3];
const rulesVersion = Number(process.argv[4]);
if (!hash || !image || !Number.isSafeInteger(rulesVersion)) {
  throw new Error("usage: keeperReleaseCli <deployed-programdata-sha256> <keeper-image-sha256:digest> <rules-version>");
}
process.stdout.write(`${JSON.stringify(keeperReleaseRecord(hash, image, rulesVersion), null, 2)}\n`);
