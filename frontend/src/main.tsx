import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { enregistrerServiceWorker } from "./pwa/register";
import { chargerEtAppliquerBranding } from "./lib/branding";
import "./index.css";
import "./styles/rtl.css";

// Le bandeau de mise à jour lui-même vit dans <App> (voir BandeauMiseAJour) ;
// ici on se contente de faire remonter l'événement "mise à jour disponible"
// jusqu'à un événement DOM que ce composant écoute.
enregistrerServiceWorker(() => {
  window.dispatchEvent(new CustomEvent("ppb:maj-disponible"));
});

// Volontairement non bloquant pour le premier rendu (voir docstring du
// module) : l'app s'affiche avec les couleurs par défaut de
// tailwind.config, puis bascule sur l'identité personnalisée dès que
// /branding répond — jamais un écran blanc en attente du logo.
void chargerEtAppliquerBranding();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
