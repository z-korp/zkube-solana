import type { CapacitorConfig } from "@capacitor/cli";

const target = process.env.VITE_ZKUBE_BUILD ?? "solana";
if (target !== "solana" && target !== "store" && target !== "playtest") {
  throw new Error(`Unknown VITE_ZKUBE_BUILD target: ${target}`);
}

const commonPlugins = [
  "@capacitor/app",
  "@capacitor/preferences",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
];
const nativePlugins =
  target === "store"
    ? [...commonPlugins, "@capgo/native-purchases"]
    : commonPlugins;

const config: CapacitorConfig = {
  appId: "com.zkorp.zkube",
  appName: "zKube",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: { includePlugins: nativePlugins },
  ios: { includePlugins: nativePlugins },
};

export default config;
