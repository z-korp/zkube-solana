import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.VITE_ZKUBE_BUILD;
assert(
  target === "solana" || target === "store",
  "VITE_ZKUBE_BUILD must select solana or store for native validation",
);
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
const expectedPlugins = [
  "@capacitor/app",
  "@capacitor/preferences",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
  ...(target === "store" ? ["@capgo/native-purchases"] : []),
];
assert(
  JSON.stringify(config.android?.includePlugins) === JSON.stringify(expectedPlugins),
  `${target} Android plugins must match its product boundary`,
);
assert(
  JSON.stringify(config.ios?.includePlugins) === JSON.stringify(expectedPlugins),
  `${target} iOS plugins must match its product boundary`,
);

const androidGradle = await source("android/app/build.gradle");
const iosProject = await source("ios/App/App.xcodeproj/project.pbxproj");
assert(
  androidGradle.includes("productFlavors") &&
    androidGradle.includes('applicationId "com.zkorp.zkube"') &&
    androidGradle.includes('applicationId "com.zkorp.zkube.store"'),
  "Android product flavors must carry distinct application IDs",
);
assert(
  androidGradle.includes(
    "solanaImplementation 'com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.7'",
  ),
  "Mobile Wallet Adapter must compile only into the Solana flavor",
);
assert(
  iosProject.includes("PRODUCT_BUNDLE_IDENTIFIER = com.zkorp.zkube;"),
  "iOS bundle identifier must match Capacitor",
);
const solanaActivity = await source(
  "android/app/src/solana/java/com/zkorp/zkube/MainActivity.java",
);
const solanaBridge = await source(
  "android/app/src/solana/java/com/zkorp/zkube/MwaBridge.kt",
);
const storeActivity = await source(
  "android/app/src/store/java/com/zkorp/zkube/MainActivity.java",
);
const storeManifest = await source("android/app/src/store/AndroidManifest.xml");
assert(
  solanaActivity.includes("registerPlugin(MwaBridge.class)") &&
    solanaBridge.includes('@CapacitorPlugin(name = "MwaBridge")'),
  "Solana flavor must retain the native MWA bridge",
);
assert(
  !storeActivity.includes("MwaBridge") &&
    storeManifest.includes("com.android.vending.BILLING"),
  "Store flavor must replace MWA with the billing permission",
);

const listing = JSON.parse(await source("dapp-store/publishing.json"));
const packageJson = JSON.parse(await source("package.json"));
assert(listing.schemaVersion === 1, "dApp Store config schema must be 1");
assert(
  listing.packageName === "com.zkorp.zkube",
  "dApp Store publishing must remain on the Solana flavor",
);
assert(
  packageJson.engines?.node === "24.x",
  "Node must stay on one supported major instead of floating to new majors",
);
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
assert(
  /target:\s*\n\s+description:[\s\S]*?type: choice[\s\S]*?- solana[\s\S]*?- store/.test(
    androidWorkflow,
  ) &&
    androidWorkflow.includes("VITE_ZKUBE_BUILD: ${{ inputs.target }}") &&
    androidWorkflow.includes("inputs.publish && inputs.target == 'solana'") &&
    androidWorkflow.includes("inputs.target == 'store' && inputs.publish"),
  "Android workflow must select a flavor and refuse store publishing",
);
const iosWorkflow = await source("../.github/workflows/mobile-ios.yml");
assert(
  iosWorkflow.includes("VITE_ZKUBE_BUILD: store") &&
    !iosWorkflow.includes("VITE_ZKUBE_BUILD: solana"),
  "iOS workflow must build the store target only",
);

console.log(`${target} Capacitor and mobile release configuration are internally consistent`);

async function source(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
