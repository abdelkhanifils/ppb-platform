/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Valeurs par défaut = identité institutionnelle actuelle (repli si
        // /branding est indisponible ou pas encore personnalisé — voir
        // src/lib/branding.ts, qui définit ces variables au démarrage).
        cebevirha: {
          DEFAULT: "var(--couleur-primaire, #0f5132)",
          light: "var(--couleur-primaire-claire, #146c43)",
        },
      },
    },
  },
  plugins: [],
};
