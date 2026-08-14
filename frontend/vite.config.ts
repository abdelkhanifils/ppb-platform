import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Application terrain (Modules Scan/Contrôle) : PWA installable, Service Worker
// personnalisé (src/sw.ts), fonctionnement hors-ligne — voir Document technique
// §"Architecture technique" (M4/M5). `injectManifest` (plutôt que `generateSW`)
// est nécessaire ici : le SW doit importer notre logique métier de synchronisation
// (app/db/queueEmission.ts), pas seulement mettre en cache des fichiers statiques.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // Le cache applicatif (schémas, passeports préchargés, file de
        // synchronisation) est structuré séparément dans IndexedDB — voir
        // src/db/. Le précache du SW ne couvre que l'app shell (JS/CSS/HTML),
        // jamais les données métier ni la moindre image.
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      },
      registerType: "prompt", // jamais "autoUpdate" ici : voir la note dans sw.ts
      manifest: {
        name: "Passeport Pour Bétail — Émission terrain",
        short_name: "PPB Émission",
        theme_color: "#0f5132",
        display: "standalone",
        start_url: "/",
      },
      devOptions: { enabled: true, type: "module" },
    }),
  ],
  resolve: { alias: { "@": "/src" } },
  server: { port: 5173 },
});
