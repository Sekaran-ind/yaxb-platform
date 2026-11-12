// Kiosk themes (styles.css [data-theme]). "system" follows the device: Classic by day, Night when
// the device is in dark mode.

export const THEMES = [
  { id: "classic", label: "Classic", description: "Ink on warm white, teal accent", swatch: ["#fafaf9", "#14b8a6", "#111113"], dark: false },
  { id: "calm", label: "Calm", description: "Soft blue, for quiet spaces", swatch: ["#f7f8fc", "#6b8cff", "#24357a"], dark: false },
  { id: "warm", label: "Warm", description: "Saffron and clay", swatch: ["#fdf7ee", "#f2a23a", "#3a2616"], dark: false },
  { id: "night", label: "Night", description: "Dark, for low light", swatch: ["#0e1317", "#2dd4bf", "#5eead4"], dark: true },
  { id: "contrast", label: "High contrast", description: "Black, white and yellow; largest contrast", swatch: ["#000000", "#ffd400", "#ffffff"], dark: true },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type ThemeChoice = ThemeId | "system";

export const isThemeChoice = (v: unknown): v is ThemeChoice => v === "system" || THEMES.some((t) => t.id === v);

const darkQuery = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

export function resolveTheme(choice: ThemeChoice): ThemeId {
  if (choice !== "system") return choice;
  if (darkQuery()?.matches) return "night";
  if (typeof matchMedia === "function" && matchMedia("(prefers-contrast: more)").matches) return "contrast";
  return "classic";
}

/** Set the theme on <html> (and the browser's theme colour); returns a function to stop following the device. */
export function applyTheme(choice: ThemeChoice): () => void {
  const set = () => {
    const id = resolveTheme(choice);
    const root = document.documentElement;
    if (id === "classic") delete root.dataset.theme;
    else root.dataset.theme = id;
    root.style.colorScheme = THEMES.find((t) => t.id === id)?.dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(root).getPropertyValue("--color-canvas").trim() || "#ffffff");
  };
  set();
  if (choice !== "system") return () => {};
  const q = darkQuery();
  q?.addEventListener("change", set);
  return () => q?.removeEventListener("change", set);
}
