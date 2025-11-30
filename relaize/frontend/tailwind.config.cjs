/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    fontSize: {
      xs: ["0.85rem", { lineHeight: "1.3rem" }],
      sm: ["0.95rem", { lineHeight: "1.45rem" }],
      base: ["1.06rem", { lineHeight: "1.7rem" }],
      lg: ["1.2rem", { lineHeight: "1.85rem" }],
      xl: ["1.4rem", { lineHeight: "2rem" }],
      "2xl": ["1.65rem", { lineHeight: "2.2rem" }],
      "3xl": ["1.95rem", { lineHeight: "2.4rem" }],
      "4xl": ["2.3rem", { lineHeight: "2.75rem" }],
      "5xl": ["2.7rem", { lineHeight: "3rem" }],
      "6xl": ["3.2rem", { lineHeight: "3.5rem" }],
    },
    extend: {
      colors: {
        brand: {
          primary: "#667eea",
          secondary: "#764ba2",
          accent: "#51cf66",
        },
      },
      boxShadow: {
        card: "0 10px 40px rgba(0, 0, 0, 0.1)",
      },
    },
  },
  plugins: [],
};
