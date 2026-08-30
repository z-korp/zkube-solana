import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configModule = await import(
  pathToFileURL(resolve(root, "capacitor.config.ts")).href
);
const config = configModule.default;

assert(config.appId === "com.zkorp.zkube", "Capacitor appId must be canonical");
assert(config.appName === "zKube", "Capacitor appName must be canonical");
assert(config.webDir === "dist", "Capacitor must package the Vite dist directory");
assert(
  config.server?.androidScheme === "https" && config.server?.url === undefined,
  "Capacitor must use bundled assets over the Android https scheme",
);

const androidGradle = await source("android/app/build.gradle");
const iosProject = await source("ios/App/App.xcodeproj/project.pbxproj");
assert(
  androidGradle.includes('applicationId "com.zkorp.zkube"'),
  "Android applicationId must match Capacitor",
);
assert(
  iosProject.includes("PRODUCT_BUNDLE_IDENTIFIER = com.zkorp.zkube;"),
  "iOS bundle identifier must match Capacitor",
);

const listing = JSON.parse(await source("dapp-store/publishing.json"));
assert(listing.schemaVersion === 1, "dApp Store config schema must be 1");
assert(listing.packageName === config.appId, "dApp Store package must match Capacitor");
assert(
  listing.cli?.package === "@solana-mobile/dapp-store-cli" &&
    /^\d+\.\d+\.\d+$/.test(listing.cli?.version),
  "dApp Store CLI must be pinned exactly",
);
assert(
  listing.approvalEnvironment === "solana-dapp-store-publish",
  "dApp Store publishing must use its approval environment",
);
for (const field of ["publisherNft", "appNft", "releaseNft"]) {
  assert(
    listing[field] === null || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(listing[field]),
    `${field} must be unset or a public Solana address`,
  );
}

const fastfile = await source("fastlane/Fastfile");
assert(count(fastfile, "lane :beta do") === 2, "Fastlane needs two beta lanes");
assert(count(fastfile, "lane :release do") === 2, "Fastlane needs two release lanes");
assert(
  fastfile.includes('ENV["MOBILE_RELEASE_APPROVED"] == "true"'),
  "release lanes must require explicit approval",
);

for (const workflowName of ["mobile-android.yml", "mobile-ios.yml"]) {
  const workflow = await source(`../.github/workflows/${workflowName}`);
  assert(workflow.includes("workflow_dispatch:"), `${workflowName} must be manual`);
  assert(!/^\s+(push|pull_request):/m.test(workflow), `${workflowName} must not run on source events`);
}
const androidWorkflow = await source("../.github/workflows/mobile-android.yml");
assert(
  androidWorkflow.includes("environment: solana-dapp-store-publish"),
  "dApp Store publishing must have a separate environment approval",
);

console.log("Capacitor and mobile release configuration are internally consistent");

async function source(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
