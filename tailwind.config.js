const colors = require("tailwindcss/colors");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: colors.zinc[950],
        card: colors.zinc[900],
        border: colors.zinc[800],
        foreground: colors.zinc[100],
        muted: colors.zinc[400],
        accent: colors.emerald[500],
        "accent-hover": colors.emerald[400],
        success: colors.emerald[500],
        danger: colors.rose[500],
        warning: colors.amber[500],
      },
      fontFamily: {
        sans: ["Inter_400Regular", "system-ui", "sans-serif"],
        medium: ["Inter_500Medium"],
        semibold: ["Inter_600SemiBold"],
        bold: ["Inter_700Bold"],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "20px",
      },
    },
  },
  plugins: [],
};
