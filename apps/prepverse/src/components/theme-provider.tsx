"use client";

import { useCallback, useEffect, useState } from "react";
import { ThemeContext, type Theme } from "@/components/theme-context";

const STORAGE_KEY = "prepverse-theme";

function readTheme(value: string | null): Theme {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function automaticThemeIsDark(now = new Date()) {
  const hour = now.getHours();
  return hour < 5 || hour >= 17;
}

function millisecondsUntilNextThemeChange(now = new Date()) {
  const next = new Date(now);
  if (now.getHours() < 5) next.setHours(5, 0, 0, 0);
  else if (now.getHours() < 17) next.setHours(17, 0, 0, 0);
  else {
    next.setDate(next.getDate() + 1);
    next.setHours(5, 0, 0, 0);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

function applyTheme(theme: Theme, focusMode: boolean) {
  const dark = focusMode || theme === "dark" || (theme === "system" && automaticThemeIsDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, updateTheme] = useState<Theme>("system");
  const [focusMode, updateFocusMode] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    updateTheme(readTheme(window.localStorage.getItem(STORAGE_KEY)));
    setReady(true);
    const syncFromAnotherTab = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      updateTheme(readTheme(event.newValue));
    };
    window.addEventListener("storage", syncFromAnotherTab);
    return () => window.removeEventListener("storage", syncFromAnotherTab);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyTheme(theme, focusMode);
    if (theme !== "system" || focusMode) return;

    const refreshAutomaticTheme = () => applyTheme("system", false);
    const timer = window.setTimeout(refreshAutomaticTheme, millisecondsUntilNextThemeChange() + 50);
    window.addEventListener("focus", refreshAutomaticTheme);
    document.addEventListener("visibilitychange", refreshAutomaticTheme);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshAutomaticTheme);
      document.removeEventListener("visibilitychange", refreshAutomaticTheme);
    };
  }, [focusMode, ready, theme]);

  const setTheme = useCallback((next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    updateTheme(next);
  }, []);
  const setFocusMode = useCallback((active: boolean) => updateFocusMode(active), []);

  return <ThemeContext.Provider value={{ theme, setTheme, setFocusMode }}>{children}</ThemeContext.Provider>;
}
