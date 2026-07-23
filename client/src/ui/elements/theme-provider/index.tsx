/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  loadThemeTemplate,
  saveThemeTemplate,
  THEME_IDS,
  type ThemeId,
} from "@/config/themes";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  defaultThemeTemplate?: ThemeId;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themeTemplate: ThemeId;
  /** Set the active theme. Pass `save = false` for temporary overrides (e.g. zone themes). */
  setThemeTemplate: (themeTemplate: ThemeId, save?: boolean) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  themeTemplate: "theme-1",
  setThemeTemplate: () => {},
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultThemeTemplate = "theme-1",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  );
  const [themeTemplate, setThemeTemplateState] = useState<ThemeId>(() => {
    const stored = loadThemeTemplate();
    return THEME_IDS.includes(stored) ? stored : defaultThemeTemplate;
  });

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }

    root.dataset.theme = themeTemplate;
  }, [theme, themeTemplate]);

  // Stable setter identities. A fresh function every render would land in the
  // dependency arrays of consumer theme effects (HomePage, PlayScreen, …),
  // re-firing them on every provider render. When two mounted screens target
  // different zone themes (e.g. Arcade→Play during the AnimatePresence
  // transition into yesterday's Practice run), that turns into an unbounded
  // themeTemplate flip → "Maximum update depth exceeded" (React #185).
  const setTheme = useCallback(
    (next: Theme) => {
      localStorage.setItem(storageKey, next);
      setThemeState(next);
    },
    [storageKey],
  );
  const setThemeTemplate = useCallback(
    (nextThemeTemplate: ThemeId, save = true) => {
      if (!THEME_IDS.includes(nextThemeTemplate)) return;
      if (save) saveThemeTemplate(nextThemeTemplate);
      setThemeTemplateState(nextThemeTemplate);
    },
    [],
  );

  // Memoized so theme consumers only re-render when the theme itself changes,
  // not on every provider render.
  const value = useMemo<ThemeProviderState>(
    () => ({ theme, setTheme, themeTemplate, setThemeTemplate }),
    [theme, setTheme, themeTemplate, setThemeTemplate],
  );

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export type { ThemeId };
