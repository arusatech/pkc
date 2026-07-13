import type { CapacitorConfig } from "@capacitor/cli";

const config = {
  appId: "ai.annadata.pkc",
  appName: "PKC",
  webDir: "dist",
  electron: {
    splashScreenEnabled: false,
    trayIconAndMenuEnabled: false,
    deepLinkingEnabled: false,
    customUrlScheme: "pkc",
  },
} as CapacitorConfig;

export default config;
