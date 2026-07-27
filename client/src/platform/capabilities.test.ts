// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  classifyPlatform,
  hasConservativeTwaSignal,
  platformCapabilities,
  supportsMobileWalletAdapter,
  type PlatformEnvironment,
  type PlatformKind,
} from "./capabilities";

const CHROME_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
const FIREFOX_ANDROID =
  "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";

function environment(
  overrides: Partial<PlatformEnvironment> = {},
): PlatformEnvironment {
  return {
    userAgent: CHROME_DESKTOP,
    navigatorPlatform: "Win32",
    maxTouchPoints: 0,
    displayModeStandalone: false,
    navigatorStandalone: false,
    referrer: "",
    ...overrides,
  };
}

describe("platform capability classification", () => {
  it("keeps desktop Wallet Standard outside Mobile Wallet Adapter", () => {
    const capabilities = platformCapabilities(environment());

    expect(capabilities).toEqual({
      kind: "desktop",
      displayModeStandalone: false,
      twaSignal: false,
      mobileWalletAdapterSupported: false,
    });
  });

  it("supports MWA in an Android browser", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: CHROME_ANDROID,
        navigatorPlatform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    );

    expect(capabilities.kind).toBe("android-browser");
    expect(capabilities.mobileWalletAdapterSupported).toBe(true);
  });

  it("does not use an unreliable browser-brand claim to block Android registration", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: FIREFOX_ANDROID,
        navigatorPlatform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    );

    expect(capabilities.kind).toBe("android-browser");
    expect(capabilities.mobileWalletAdapterSupported).toBe(true);
  });

  it("classifies standalone Android as an installed PWA", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: CHROME_ANDROID,
        displayModeStandalone: true,
      }),
    );

    expect(capabilities.kind).toBe("android-pwa");
    expect(capabilities.displayModeStandalone).toBe(true);
    expect(capabilities.mobileWalletAdapterSupported).toBe(true);
  });

  it("requires a standalone android-app referrer for the TWA signal", () => {
    const installedPwa = environment({
      userAgent: CHROME_ANDROID,
      displayModeStandalone: true,
      referrer: "https://zkube.gg/",
    });
    const twa = environment({
      userAgent: CHROME_ANDROID,
      displayModeStandalone: true,
      referrer: "android-app://gg.zkube.app/",
    });

    expect(hasConservativeTwaSignal(installedPwa)).toBe(false);
    expect(classifyPlatform(installedPwa)).toBe("android-pwa");
    expect(hasConservativeTwaSignal(twa)).toBe(true);
    expect(classifyPlatform(twa)).toBe("twa");
    expect(platformCapabilities(twa).mobileWalletAdapterSupported).toBe(true);
  });

  it("classifies iPhone and touch-based iPadOS without enabling MWA", () => {
    const iphone = environment({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      navigatorPlatform: "iPhone",
      maxTouchPoints: 5,
      navigatorStandalone: true,
    });
    const ipad = environment({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      navigatorPlatform: "MacIntel",
      maxTouchPoints: 5,
    });

    expect(classifyPlatform(iphone)).toBe("ios");
    expect(classifyPlatform(ipad)).toBe("ios");
    expect(supportsMobileWalletAdapter("ios")).toBe(false);
  });

  it("uses unknown for environments without a supported platform signal", () => {
    expect(
      classifyPlatform(
        environment({
          userAgent: "custom-runtime/1.0",
          navigatorPlatform: "",
        }),
      ),
    ).toBe("unknown");
  });
});

describe("Mobile Wallet Adapter support decision", () => {
  it.each<[PlatformKind, boolean]>([
    ["desktop", false],
    ["android-browser", true],
    ["android-pwa", true],
    ["twa", true],
    ["ios", false],
    ["unknown", false],
  ])("returns %s => %s", (kind, supported) => {
    expect(supportsMobileWalletAdapter(kind)).toBe(supported);
  });
});
