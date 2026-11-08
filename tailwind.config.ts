import type { Config } from "tailwindcss";

// ReleaseOS midnight theme.
// Every colour scale is remapped so the light-theme contrast PAIRS keep working on dark surfaces:
//   white  → card surface, slate-50 → recessed panel, slate-900 → primary text,
//   {hue}-50/100 → dark tints, {hue}-200/300 → tinted borders, {hue}-600..900 → light readable text.
// Existing class names across the app therefore render as a coherent dark UI without per-file rewrites.
// Use `ink` (true white) and `night` (fixed dark surfaces) when a colour must NOT be remapped.
// Generated from tailwindcss/colors (500 mixed into #0c1322 for 50–300; 300/200/100 reused for 700/800/900).
const palette = {"red":{"50":"#231825","100":"#301b27","200":"#50222c","300":"#722931","400":"#f87171","500":"#ef4444","600":"#f87171","700":"#fca5a5","800":"#fecaca","900":"#fee2e2","950":"#fef2f2"},"orange":{"50":"#241d21","100":"#322220","200":"#53301e","300":"#773e1d","400":"#fb923c","500":"#f97316","600":"#fb923c","700":"#fdba74","800":"#fed7aa","900":"#ffedd5","950":"#fff7ed"},"amber":{"50":"#232120","100":"#31291e","200":"#523d1b","300":"#755218","400":"#fbbf24","500":"#f59e0b","600":"#fbbf24","700":"#fcd34d","800":"#fde68a","900":"#fef3c7","950":"#fffbeb"},"yellow":{"50":"#22231f","100":"#302d1e","200":"#4f431a","300":"#705b16","400":"#facc15","500":"#eab308","600":"#facc15","700":"#fde047","800":"#fef08a","900":"#fef9c3","950":"#fefce8"},"lime":{"50":"#182621","100":"#1f3120","200":"#304b1e","300":"#42661d","400":"#a3e635","500":"#84cc16","600":"#a3e635","700":"#bef264","800":"#d9f99d","900":"#ecfccb","950":"#f7fee7"},"green":{"50":"#0e2528","100":"#102f2c","200":"#134834","300":"#16633d","400":"#4ade80","500":"#22c55e","600":"#4ade80","700":"#86efac","800":"#bbf7d0","900":"#dcfce7","950":"#f0fdf4"},"emerald":{"50":"#0c242c","100":"#0d2e31","200":"#0d453e","300":"#0e5e4d","400":"#34d399","500":"#10b981","600":"#34d399","700":"#6ee7b7","800":"#a7f3d0","900":"#d1fae5","950":"#ecfdf5"},"teal":{"50":"#0d242f","100":"#0d2d37","200":"#0e454a","300":"#105d5d","400":"#2dd4bf","500":"#14b8a6","600":"#2dd4bf","700":"#5eead4","800":"#99f6e4","900":"#ccfbf1","950":"#f0fdfa"},"cyan":{"50":"#0b2334","100":"#0b2d3e","200":"#0a4457","300":"#095c72","400":"#22d3ee","500":"#06b6d4","600":"#22d3ee","700":"#67e8f9","800":"#a5f3fc","900":"#cffafe","950":"#ecfeff"},"sky":{"50":"#0c2236","100":"#0c2a42","200":"#0d3f5e","300":"#0d557c","400":"#38bdf8","500":"#0ea5e9","600":"#38bdf8","700":"#7dd3fc","800":"#bae6fd","900":"#e0f2fe","950":"#f0f9ff"},"blue":{"50":"#111e37","100":"#142544","200":"#1a3462","300":"#214581","400":"#60a5fa","500":"#3b82f6","600":"#60a5fa","700":"#93c5fd","800":"#bfdbfe","900":"#dbeafe","950":"#eff6ff"},"indigo":{"50":"#151b37","100":"#1a2043","200":"#262c60","300":"#33387f","400":"#818cf8","500":"#6366f1","600":"#818cf8","700":"#a5b4fc","800":"#c7d2fe","900":"#e0e7ff","950":"#eef2ff"},"violet":{"50":"#191a37","100":"#201f44","200":"#322962","300":"#453481","400":"#a78bfa","500":"#8b5cf6","600":"#a78bfa","700":"#c4b5fd","800":"#ddd6fe","900":"#ede9fe","950":"#f5f3ff"},"purple":{"50":"#1c1a37","100":"#251e44","200":"#3b2762","300":"#523182","400":"#c084fc","500":"#a855f7","600":"#c084fc","700":"#d8b4fe","800":"#e9d5ff","900":"#f3e8ff","950":"#faf5ff"},"fuchsia":{"50":"#211837","100":"#2d1b43","200":"#4a2260","300":"#682a7e","400":"#e879f9","500":"#d946ef","600":"#e879f9","700":"#f0abfc","800":"#f5d0fe","900":"#fae8ff","950":"#fdf4ff"},"pink":{"50":"#22182e","100":"#301b35","200":"#4f2346","300":"#712b58","400":"#f472b6","500":"#ec4899","600":"#f472b6","700":"#f9a8d4","800":"#fbcfe8","900":"#fce7f3","950":"#fdf2f8"},"rose":{"50":"#231728","100":"#311a2c","200":"#522034","300":"#74273d","400":"#fb7185","500":"#f43f5e","600":"#fb7185","700":"#fda4af","800":"#fecdd3","900":"#ffe4e6","950":"#fff1f2"},"slate":{"50":"#0a101c","100":"#131d31","200":"#1b2740","300":"#283754","400":"#64748f","500":"#8b98b3","600":"#a8b3c8","700":"#c5cddc","800":"#dfe5ef","900":"#f1f4f9","950":"#fbfcfe"}};

const config: Config = {
  content: ["./pages/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ...palette,
        white: "#0c1322",
        black: "#000000",
        ink: { DEFAULT: "#ffffff", soft: "#cfd8e6", muted: "#8b98b3" },
        night: { 950: "#04070d", 900: "#060912", 850: "#080d18", 800: "#0c1322", 700: "#111a2d", 600: "#18233a" },
        accent: { cyan: "#22d3ee", teal: "#2dd4bf", navy: "#1e3a8a", amber: "#fbbf24" },
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,.25), 0 8px 30px -8px rgba(34,211,238,.25)",
        "glow-amber": "0 0 0 1px rgba(251,191,36,.35), 0 8px 30px -8px rgba(251,191,36,.3)",
        "glow-red": "0 0 0 1px rgba(248,113,113,.4), 0 8px 30px -8px rgba(248,113,113,.3)",
      },
    },
  },
  plugins: [],
};
export default config;
