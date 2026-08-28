export type ThemeMode = "light" | "dark";

export interface BrandColors {
  primary?: string;
  accent?: string;
}

export interface DerivedTheme {
  mode: ThemeMode;

  navBg: string;
  navText: string;
  navTextMuted: string;
  navBorder: string;

  contentBg: string;
  contentText: string;
  contentTextMuted: string;
  contentBorder: string;
  contentCodeBg: string;
  contentTableStripeBg: string;
  inlineCodeText: string;

  surface: string;
  surfaceHover: string;
  shadowSm: string;
  shadowMd: string;

  codePanelBg: string;
  codePanelText: string;
  codePanelBorder: string;
  codePanelMuted: string;

  primary: string;
  accent: string;
  primarySoft: string;
  accentSoft: string;

  methodGet: string;
  methodPost: string;
  methodPut: string;
  methodPatch: string;
  methodDelete: string;
}

const METHODS = {
  methodGet: "#22c55e",
  methodPost: "#3b82f6",
  methodPut: "#f59e0b",
  methodPatch: "#a855f7",
  methodDelete: "#ef4444",
};

export function deriveTheme(brand: BrandColors, mode: ThemeMode): DerivedTheme {
  const primary = brand.primary ?? "#FF4500";
  const accent = brand.accent ?? primary;

  const softAlpha = mode === "dark" ? 0.2 : 0.12;
  const primarySoft = hexToRgba(primary, softAlpha);
  const accentSoft = hexToRgba(accent, softAlpha);

  const codePanel = {
    codePanelBg: "#0d1117",
    codePanelText: "#e6edf3",
    codePanelBorder: "#21262d",
    codePanelMuted: "#8b949e",
  };

  if (mode === "dark") {
    return {
      mode,
      navBg: "#0d1117",
      navText: "#e6edf3",
      navTextMuted: "rgba(230,237,243,0.5)",
      navBorder: "rgba(255,255,255,0.08)",
      contentBg: "#161b22",
      contentText: "#e6edf3",
      contentTextMuted: "#8b949e",
      contentBorder: "#2a313c",
      contentCodeBg: "#0d1117",
      contentTableStripeBg: "#1c2128",
      inlineCodeText: "#9ca3af",
      surface: "#1c222b",
      surfaceHover: "#222933",
      shadowSm: "0 1px 2px rgba(0,0,0,0.3)",
      shadowMd: "0 8px 24px rgba(0,0,0,0.4)",
      ...codePanel,
      primary,
      accent,
      primarySoft,
      accentSoft,
      ...METHODS,
    };
  }

  return {
    mode,
    navBg: "#f7f6f3",
    navText: "#1f1d1a",
    navTextMuted: "#6b6862",
    navBorder: "#e6e3dd",
    contentBg: "#faf9f7",
    contentText: "#1f1d1a",
    contentTextMuted: "#6b6862",
    contentBorder: "#e6e3dd",
    contentCodeBg: "#f1efea",
    contentTableStripeBg: "#f4f2ee",
    inlineCodeText: "#4b5563",
    surface: "#ffffff",
    surfaceHover: "#fbfaf8",
    shadowSm: "0 1px 2px rgba(28,25,23,0.04), 0 1px 3px rgba(28,25,23,0.06)",
    shadowMd: "0 6px 20px rgba(28,25,23,0.08)",
    ...codePanel,
    primary,
    accent,
    primarySoft,
    accentSoft,
    ...METHODS,
  };
}

export function getDefaultMode(): ThemeMode {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? "light" : "dark";
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6) return hex;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}