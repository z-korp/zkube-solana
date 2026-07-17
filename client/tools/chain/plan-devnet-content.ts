import {
  buildContentReleasePreview,
  formatContentReleasePreview,
} from "../../src/chain/contentReleasePlan";

void buildContentReleasePreview(process.env.ZKUBE_BASE_RPC)
  .then((preview) => {
    process.stdout.write(`${formatContentReleasePreview(preview)}\n`);
  })
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
