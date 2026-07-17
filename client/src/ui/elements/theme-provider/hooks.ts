import { useContext } from 'react';
import { ThemeProviderContext } from '.';
import { getThemeColors, type ThemeColors } from '@/config/themes';

export const useTheme = () => {
    const context = useContext(ThemeProviderContext);

    if (context === undefined)
      throw new Error("useTheme must be used within a ThemeProvider");

    return context;
  };

/** Palette of the active theme — shorthand for getThemeColors(useTheme().themeTemplate). */
export function useThemeColors(): ThemeColors {
  const { themeTemplate } = useTheme();
  return getThemeColors(themeTemplate);
}
