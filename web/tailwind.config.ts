import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b1020", 900: "#101727", 800: "#1a2438" },
        paper: "#fbfaf8",
      },
      fontFamily: {
        sans: ["var(--font-ui)", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        pane: "0 1px 0 rgba(16,23,43,.06), 0 8px 30px rgba(11,15,34,.06)",
      },
    },
  },
  plugins: [],
};

export default config;
