export type BrandTokens = {
  canvas: string;
  paper: string;
  ember: string;
  gold: string;
  signal: string;
  muted: string;
  wordmark: string;
};

/** Core brand palette. `public/styles.css` declares the same hex values as `--mf-*` custom properties. */
export const BRAND: BrandTokens = {
  canvas: "#0B0C0F",
  paper: "#F4EFE6",
  ember: "#E8A87C",
  gold: "#D4A017",
  signal: "#5CE1E6",
  muted: "#9A9488",
  wordmark: "MENTION//FORGE",
};

/**
 * Website design system. Each key maps 1:1 to a CSS custom property in `public/styles.css`
 * (`colors.surface1` → `--mf-surface-1`, `space[4]` → `--space-4`, …). A unit test keeps the
 * two in sync. Documented in `docs/DESIGN-SYSTEM.md`.
 *
 * Every text colour below clears WCAG 2.2 AA (4.5:1) on every surface colour.
 */
export const DESIGN_TOKENS = {
  colors: {
    canvas: BRAND.canvas,
    surface1: "#111318",
    surface2: "#161920",
    surface3: "#1C2029",
    code: "#08090C",
    paper: BRAND.paper,
    text2: "#CFC9BD",
    muted: BRAND.muted,
    ember: BRAND.ember,
    gold: BRAND.gold,
    signal: BRAND.signal,
    ok: "#7EE0A1",
    warn: "#F2C46D",
    danger: "#F08A7E",
  },
  /** Fluid type scale (rem at the 16px root). */
  type: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    md: "1.125rem",
    lg: "1.25rem",
    xl: "clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)",
    "2xl": "clamp(1.75rem, 1.35rem + 1.5vw, 2.5rem)",
    "3xl": "clamp(2.125rem, 1.5rem + 2.6vw, 3.5rem)",
    display: "clamp(2.5rem, 1.45rem + 4.4vw, 4.75rem)",
  },
  /** 4px spacing grid. */
  space: {
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    5: "1.25rem",
    6: "1.5rem",
    8: "2rem",
    10: "2.5rem",
    12: "3rem",
    16: "4rem",
    20: "5rem",
    24: "6rem",
  },
  radius: {
    sm: "6px",
    md: "10px",
    lg: "16px",
    xl: "24px",
    pill: "999px",
  },
  motion: {
    fast: "140ms",
    base: "220ms",
    slow: "420ms",
    easeOut: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  },
  layout: {
    container: "72rem",
    prose: "68ch",
    header: "4rem",
  },
} as const;

export const VALUE_PROP =
  "The highest-quality, lowest-latency, agent-optimized social listening + product/company research tool that returns perfectly structured, cited, multi-source intelligence in a single call so agents can make better decisions faster.";
