import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { enregistrerServiceWorker } from "./pwa/register";
import "./index.css";

// Le bandeau de mise à jour lui-même vit dans <App> (voir BandeauMiseAJour) ;
// ici on se contente de faire remonter l'événement "mise à jour disponible"
// jusqu'à un événement DOM que ce composant écoute.
enregistrerServiceWorker(() => {
  window.dispatchEvent(new CustomEvent("ppb:maj-disponible"));
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
