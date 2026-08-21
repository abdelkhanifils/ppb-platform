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
        // Doré institutionnel — écho volontairement adouci de la bande jaune
        // du logo (#FEFB00 dans le fichier source : trop intense en usage
        // interface prolongé, réservé à l'imprimé). Accent seulement —
        // jamais de grands aplats ni de texte sur fond jaune plein.
        or: {
          DEFAULT: "#eab308",
          light: "#fde68a",
        },
      },
    },
  },
  plugins: [],
};
