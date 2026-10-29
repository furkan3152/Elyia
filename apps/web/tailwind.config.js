/**
 * Tailwind maps every colour to a CSS custom property from src/styles/tokens.css,
 * so one class follows both themes ("Night of the fields" dark, "Dawn" light).
 * The palette is replaced, not extended: only Elyia tokens exist, which keeps
 * pages on-palette. Channel variables (`--violet: 139 92 246`) allow alpha
 * modifiers such as `bg-violet/20`.
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
      ink: {
        gold: channel("on-gold"),
        violet: channel("on-violet"),
        mint: channel("on-mint"),
        rose: channel("on-rose"),
      },
    },
    fontFamily: {
      display: ['"Instrument Serif"', "Georgia", "Times New Roman", "serif"],
      sans: ['"Inter Variable"', "Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      mono: ['"JetBrains Mono Variable"', "JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      numeral: ['"Fraunces Variable"', '"Instrument Serif"', "Georgia", "serif"],
    },
    extend: {
      fontSize: {
        // 12 px floor for anything a person must read.
        micro: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.16em" }],
        "display-xl": ["clamp(3.25rem, 8vw, 6.5rem)", { lineHeight: "0.95", letterSpacing: "-0.01em" }],
        "display-lg": ["clamp(2.5rem, 5.5vw, 4rem)", { lineHeight: "1", letterSpacing: "-0.005em" }],
        "display-md": ["clamp(2rem, 4vw, 3.25rem)", { lineHeight: "1.05" }],
        "display-sm": ["clamp(1.6rem, 2.6vw, 2rem)", { lineHeight: "1.1" }],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        "3xl": "24px",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 24px 60px -24px var(--shadow-strong)",
        raised: "0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 18px 50px -20px var(--shadow-strong)",
        "glow-violet": "0 0 0 1px rgb(var(--violet-glow) / 0.35), 0 0 0 6px rgb(var(--violet) / 0.08), 0 24px 60px var(--shadow-soft)",
        "glow-gold": "0 0 24px rgb(var(--gold) / 0.35)",
        focus: "0 0 0 2px rgb(var(--bg-0)), 0 0 0 4px rgb(var(--violet-glow))",
      },
      transitionTimingFunction: {
        pluck: "cubic-bezier(.2,.9,.1,1)",
        standard: "cubic-bezier(.2,0,0,1)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "220ms",
        slow: "600ms",
      },
      keyframes: {
        "aurora-a": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(-4%, 3%, 0) scale(1.06)" },
        },
        "aurora-b": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(5%, -4%, 0) scale(0.96)" },
        },
        breathe: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "0.9" },
        },
        heartbeat: {
          "0%": { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(var(--gold) / 0.55)" },
          "35%": { transform: "scale(1.35)", boxShadow: "0 0 0 5px rgb(var(--gold) / 0)" },
          "100%": { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(var(--gold) / 0)" },
        },
        "flash-up": {
          "0%": { color: "rgb(var(--mint))", textShadow: "0 0 12px rgb(var(--mint) / 0.45)" },
          "100%": { color: "inherit", textShadow: "none" },
        },
        "flash-down": {
          "0%": { color: "rgb(var(--rose))", textShadow: "0 0 12px rgb(var(--rose) / 0.45)" },
          "100%": { color: "inherit", textShadow: "none" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translate3d(0, 12px, 0)" },
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
          "0%": { opacity: "0", transform: "translate3d(0, 8px, 0) scale(0.98)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0) scale(1)" },
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
        twinkle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "aurora-a": "aurora-a 22s ease-in-out infinite",
        "aurora-b": "aurora-b 28s ease-in-out infinite",
        breathe: "breathe 6s ease-in-out infinite",
        heartbeat: "heartbeat 900ms cubic-bezier(.2,.9,.1,1) 1",
        "flash-up": "flash-up 900ms ease-out 1",
        "flash-down": "flash-down 900ms ease-out 1",
        shimmer: "shimmer 1.8s linear infinite",
        "rise-in": "rise-in 600ms cubic-bezier(.2,.9,.1,1) both",
        "fade-in": "fade-in 220ms ease-out both",
        "sheet-in-right": "sheet-in-right 260ms cubic-bezier(.2,.9,.1,1) both",
        "sheet-in-bottom": "sheet-in-bottom 260ms cubic-bezier(.2,.9,.1,1) both",
        "dialog-in": "dialog-in 200ms cubic-bezier(.2,.9,.1,1) both",
        caret: "caret 1s steps(1) infinite",
        "pending-bar": "pending-bar 2.4s cubic-bezier(.2,.9,.1,1) forwards",
        twinkle: "twinkle 3.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
