/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cebevirha: { DEFAULT: "#0f5132", light: "#146c43" }, // vert institutionnel, cf. gabarit PPB
      },
    },
  },
  plugins: [],
};
