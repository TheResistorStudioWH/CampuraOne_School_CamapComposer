import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { colors } from "./model";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";
const storageKey = "camap-composer-theme-v1";
const mediaQuery = "(prefers-color-scheme: dark)";
function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Storage may be unavailable. */
  }
  return "system";
}
export function initializeTheme() {
  const preference = readPreference();
  document.documentElement.dataset.theme =
    preference === "system"
      ? window.matchMedia(mediaQuery).matches
        ? "dark"
        : "light"
      : preference;
}
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia(mediaQuery).matches,
  );
  const theme: Theme =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;
  useEffect(() => {
    const media = window.matchMedia(mediaQuery);
    const changed = () => setSystemDark(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, preference);
    } catch {
      /* Session-only preference. */
    }
    if (isTauri())
      void getCurrentWindow()
        .setTheme(preference === "system" ? null : preference)
        .catch(() => {
          /* Content remains themed if the OS cannot theme its title bar. */
        });
  }, [preference]);
  return { preference, setPreference, theme };
}
export const canvasPalettes = {
  light: {
    features: colors,
    text: "#294638",
    halo: "#f7f9ef",
    selected: "#23634d",
    outline: "#8aa196",
    areaOutline: "#9aaf90",
    pointOutline: "#ffffffcc",
    pointSelected: "#ffffff",
    handle: "#ffffff",
    route: "#2c8c70",
    closed: "#ba766a",
    road: "#688f81",
    highlighted: "#b9781f",
    preview: "#20685120",
    glyph: "#ffffff",
  },
  dark: {
    features: {
      ...colors,
      area: "#354d3d",
      building: "#465e54",
      merchant: "#6c5939",
      room: "#554c69",
      door: "#348b73",
      gate: "#348b73",
      stairs: "#a5643f",
      elevator: "#796499",
      poi: "#467c9f",
      text: "#e0eee4",
    },
    text: "#e0eee4",
    halo: "#15231b",
    selected: "#a2e4b8",
    outline: "#7f9c8d",
    areaOutline: "#6d946e",
    pointOutline: "#b4d3c3",
    pointSelected: "#fff0b0",
    handle: "#203329",
    route: "#70d9aa",
    closed: "#df9387",
    road: "#83b5a0",
    highlighted: "#f3c478",
    preview: "#95ddb730",
    glyph: "#ffffff",
  },
} as const;
