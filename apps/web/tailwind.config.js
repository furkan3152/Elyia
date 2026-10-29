/**
 * Tailwind maps every colour to a CSS custom property from src/styles/tokens.css,
 * so one class follows both sheets (DAY paper map, NIGHT headlamp). The palette
 * is replaced, not extended: only Survey tokens exist. Channel variables
 * (`--ink: 22 32 27`) allow alpha modifiers such as `border-ink/20`.
 *
 * The "Lumine" names below the Survey ones (bg-*, text-*, violet, gold, mint,
 * rose, sky, line) are aliases onto Survey tokens for pages not rebuilt yet.
 * New code uses the Survey names.
 */
const channel = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      white: "#FFFFFF",
      black: "#000000",

      // Survey
      paper: { DEFAULT: channel("paper"), 2: channel("paper-2"), 3: channel("paper-3") },
      card: channel("card"),
      ink: {
        DEFAULT: channel("ink"),
        2: channel("ink-2"),
        3: channel("ink-3"),
        // legacy "on colour" inks
        gold: channel("on-gold"),
        violet: channel("on-violet"),
        mint: channel("on-mint"),
        rose: channel("on-rose"),
      },
      rule: channel("rule"),
      contour: channel("contour"),
      signal: { DEFAULT: channel("signal"), ink: channel("on-signal") },
      accent: { DEFAULT: channel("accent"), line: channel("accent-line"), ink: channel("on-accent") },
      floor: channel("floor"),
      ridge: channel("ridge"),
      summit: { DEFAULT: channel("summit"), ink: channel("summit-ink") },
      up: channel("up"),
      down: channel("down"),
      "blaze-red": channel("blaze-red"),
      "blaze-blue": channel("blaze-blue"),
      water: channel("water"),
      warn: { DEFAULT: channel("warn"), ink: channel("warn-ink"), on: channel("on-warn") },

      // Legacy aliases
      "bg-0": channel("bg-0"),
      "bg-1": channel("bg-1"),
      "bg-2": channel("bg-2"),
      "bg-3": channel("bg-3"),
      line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
      "text-0": channel("text-0"),
      "text-1": channel("text-1"),
      "text-2": channel("text-2"),
      violet: { DEFAULT: channel("violet"), glow: channel("violet-glow"), soft: channel("violet-soft"), fill: channel("violet-fill") },
      gold: { DEFAULT: channel("gold"), deep: channel("gold-deep"), fill: channel("gold-fill") },
      mint: { DEFAULT: channel("mint"), fill: channel("mint-fill") },
      rose: { DEFAULT: channel("rose"), fill: channel("rose-fill") },
      sky: { DEFAULT: channel("sky") },
    },
    fontFamily: {
      sans: ['"Space Grotesk Variable"', '"Space Grotesk"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      sign: ['"Space Grotesk Variable"', '"Space Grotesk"', "system-ui", "sans-serif"],
      mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      map: ['"Instrument Serif"', "Georgia", "Times New Roman", "serif"],
      // legacy: display headings are Space Grotesk now; numerals are mono.
      display: ['"Space Grotesk Variable"', '"Space Grotesk"', "system-ui", "sans-serif"],
      numeral: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
    },
    borderRadius: {
      none: "0",
      sm: "1px",
      DEFAULT: "2px",
      md: "2px",
      lg: "2px",
      xl: "3px",
      "2xl": "3px",
      "3xl": "4px",
      full: "9999px",
    },
    extend: {
      fontSize: {
        // 12 px floor for anything a person must read.
        micro: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.14em" }],
        "display-xl": ["clamp(3rem, 7vw, 5rem)", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-lg": ["clamp(2.5rem, 5vw, 4rem)", { lineHeight: "1.02", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-md": ["clamp(2rem, 3.6vw, 2.75rem)", { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-sm": ["clamp(1.75rem, 2.6vw, 2.25rem)", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      borderWidth: {
        DEFAULT: "1px",
        1.5: "1.5px",
        2: "2px",
        3: "3px",
      },
      boxShadow: {
        hard: "3px 3px 0 rgb(var(--shadow-ink))",
        "hard-sm": "2px 2px 0 rgb(var(--shadow-ink))",
        "hard-lg": "4px 4px 0 rgb(var(--shadow-ink))",
        "hard-xl": "6px 6px 0 rgb(var(--shadow-ink))",
        none: "none",
        // legacy names, now hard shadows
        panel: "3px 3px 0 rgb(var(--shadow-ink))",
        raised: "4px 4px 0 rgb(var(--shadow-ink))",
        "glow-violet": "4px 4px 0 rgb(var(--shadow-ink))",
        "glow-gold": "0 0 0 2px rgb(var(--signal))",
        sm: "2px 2px 0 rgb(var(--shadow-ink))",
        focus: "0 0 0 2px rgb(var(--paper)), 0 0 0 4px rgb(var(--accent-line))",
      },
      transitionTimingFunction: {
        draw: "cubic-bezier(.2,.8,.2,1)",
        spring: "cubic-bezier(.34,1.56,.64,1)",
        out: "cubic-bezier(.16,1,.3,1)",
        standard: "cubic-bezier(.2,0,0,1)",
        pluck: "cubic-bezier(.16,1,.3,1)",
      },
      transitionDuration: {
        instant: "90ms",
        fast: "150ms",
        base: "240ms",
        slow: "420ms",
        draw: "1200ms",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        heartbeat: {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(1.35)" },
          "100%": { transform: "scale(1)" },
        },
        "flash-up": {
          "0%": { color: "rgb(var(--up))" },
          "100%": { color: "inherit" },
        },
        "flash-down": {
          "0%": { color: "rgb(var(--down))" },
          "100%": { color: "inherit" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translate3d(0, 8px, 0)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "sheet-in-right": {
          "0%": { transform: "translate3d(100%, 0, 0)" },
          "100%": { transform: "translate3d(0, 0, 0)" },
        },
        "sheet-in-bottom": {
          "0%": { transform: "translate3d(0, 100%, 0)" },
          "100%": { transform: "translate3d(0, 0, 0)" },
        },
        "dialog-in": {
          "0%": { opacity: "0", transform: "translate3d(0, 10px, 0)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
        caret: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        "pending-bar": {
          "0%": { transform: "scaleX(0)" },
          "60%": { transform: "scaleX(0.7)" },
          "100%": { transform: "scaleX(0.92)" },
        },
        // legacy loops, slowed and made quiet
        "aurora-a": { "0%, 100%": { opacity: "1" } },
        "aurora-b": { "0%, 100%": { opacity: "1" } },
        shimmer: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        twinkle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        breathe: "breathe 4s ease-in-out infinite",
        heartbeat: "heartbeat 900ms cubic-bezier(.16,1,.3,1) 1",
        "flash-up": "flash-up 900ms ease-out 1",
        "flash-down": "flash-down 900ms ease-out 1",
        "rise-in": "rise-in 420ms cubic-bezier(.16,1,.3,1) both",
        "fade-in": "fade-in 240ms ease-out both",
        "sheet-in-right": "sheet-in-right 280ms cubic-bezier(.16,1,.3,1) both",
        "sheet-in-bottom": "sheet-in-bottom 280ms cubic-bezier(.16,1,.3,1) both",
        "dialog-in": "dialog-in 240ms cubic-bezier(.16,1,.3,1) both",
        caret: "caret 1.1s steps(1) infinite",
        "pending-bar": "pending-bar 2.4s cubic-bezier(.16,1,.3,1) forwards",
        "aurora-a": "aurora-a 1s linear 1",
        "aurora-b": "aurora-b 1s linear 1",
        shimmer: "shimmer 2.4s ease-in-out infinite",
        twinkle: "twinkle 3.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
