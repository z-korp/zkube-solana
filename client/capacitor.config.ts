import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zkorp.zkube",
  appName: "zKube",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
