import type { Config } from "tailwindcss";

/**
 * Usability over decoration (PRD 6.1). The palette is deliberately plain and every
 * status pairing carries text as well as colour, so nothing depends on colour alone.
 * Contrast pairs are checked against WCAG 2.1 AA at 4.5:1 (UX-07).
 *
 * Every colour resolves through a CSS custom property rather than a literal, so the
 * whole interface switches theme by redefining the variables in one place. Pages use
 * the semantic name (`text-ink`, `bg-paper`, `border-line`) and never a raw colour,
 * which is what makes a second theme a stylesheet change rather than a rewrite.
 *
 * The channel form `rgb(var(--x) / <alpha-value>)` keeps Tailwind's opacity modifiers
 * working, so `bg-paper/80` and `text-ink/60` still behave.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: token("ink"),
          soft: token("ink-soft"),
          muted: token("ink-muted"),
          faint: token("ink-faint"),
        },
        paper: {
          DEFAULT: token("paper"),
          soft: token("paper-soft"),
          sunk: token("paper-sunk"),
        },
        /** Form control surfaces, which must stay distinct from the card they sit on. */
        field: {
          DEFAULT: token("field"),
          sunk: token("field-sunk"),
        },
        line: {
          DEFAULT: token("line"),
          strong: token("line-strong"),
        },
        brand: {
          DEFAULT: token("brand"),
          dark: token("brand-dark"),
          light: token("brand-light"),
          contrast: token("brand-contrast"),
        },
        good: { DEFAULT: token("good"), light: token("good-light") },
        warn: { DEFAULT: token("warn"), light: token("warn-light") },
        bad: { DEFAULT: token("bad"), light: token("bad-light") },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI Variable Text",
          "Segoe UI",
          "Roboto",
          "Inter",
          "Noto Sans",
          "Noto Sans Devanagari",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Cascadia Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
      },
      /**
       * Elevation is defined per theme: a drop shadow reads as depth on a light page
       * and as dirt on a dark one, where the same separation comes from a lighter
       * surface and a crisper edge.
       */
      boxShadow: {
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        overlay: "var(--shadow-overlay)",
        none: "none",
      },
      borderRadius: {
        DEFAULT: "0.375rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
      },
      maxWidth: {
        prose: "68ch",
        form: "44rem",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
    },
  },
  plugins: [],
};

export default config;
