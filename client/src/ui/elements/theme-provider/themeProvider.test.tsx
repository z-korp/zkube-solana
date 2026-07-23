import React, { useContext, useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider, ThemeProviderContext } from ".";

beforeAll(() => {
  // jsdom has no matchMedia; the provider queries it for the system color scheme.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterAll(() => vi.unstubAllGlobals());

afterEach(() => localStorage.clear());

/**
 * Reproduces the Arcade→Play transition: while AnimatePresence keeps both
 * screens mounted, HomePage drives the theme to today's zone and PlayScreen
 * drives it to yesterday's Practice zone. Their effects mirror the real ones —
 * HomePage keys on its zone id, PlayScreen guards on the live themeTemplate.
 *
 * With an unstable provider value, `setThemeTemplate` changed identity on every
 * render, both effects re-fired on every theme change, and the two targets
 * flipped forever → "Maximum update depth exceeded" (React #185). A stable
 * provider lets the guarded PlayScreen effect win and settle.
 */
const HomeLike: React.FC<{ zone: string }> = ({ zone }) => {
  const { setThemeTemplate } = useContext(ThemeProviderContext);
  useEffect(() => {
    setThemeTemplate(zone as never, false);
  }, [zone, setThemeTemplate]);
  return null;
};

const PlayLike: React.FC<{ zone: string }> = ({ zone }) => {
  const { themeTemplate, setThemeTemplate } = useContext(ThemeProviderContext);
  useEffect(() => {
    if (zone !== themeTemplate) setThemeTemplate(zone as never);
  }, [zone, setThemeTemplate, themeTemplate]);
  return null;
};

describe("ThemeProvider stability", () => {
  it("does not loop when two mounted screens target different zone themes", async () => {
    render(
      <ThemeProvider>
        <HomeLike zone="theme-2" />
        <PlayLike zone="theme-5" />
      </ThemeProvider>,
    );

    // The guarded Play effect converges; no infinite update loop is thrown.
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("theme-5"),
    );
  });

  it("keeps the setter identity stable across theme changes", async () => {
    const setters = new Set<unknown>();

    const Probe: React.FC = () => {
      const { themeTemplate, setThemeTemplate } = useContext(
        ThemeProviderContext,
      );
      setters.add(setThemeTemplate);
      useEffect(() => {
        if (themeTemplate !== "theme-4") setThemeTemplate("theme-4" as never);
      }, [themeTemplate, setThemeTemplate]);
      return null;
    };

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("theme-4"),
    );
    // The theme changed (≥1 provider re-render) but the setter never did.
    expect(setters.size).toBe(1);
  });
});
