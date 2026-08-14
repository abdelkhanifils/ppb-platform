/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

/**
 * Service Worker de l'application d'émission (Module 4).
 *
 * Trois responsabilités, volontairement séparées :
 *
 * 1. Précache de l'app shell (JS/CSS/HTML) — via workbox-precaching, généré
 *    par vite-plugin-pwa (`self.__WB_MANIFEST`). AUCUNE donnée métier ici :
 *    schémas, passeports et file de synchronisation vivent dans IndexedDB
 *    (voir src/db/), jamais dans le cache HTTP du Service Worker.
 *
 * 2. Cache runtime des données de référence peu volatiles (schémas de
 *    formulaire, liste des passeports préchargés) — pour que le premier
 *    chargement hors-ligne d'une page fonctionne même si IndexedDB n'a pas
 *    encore été rafraîchi. StaleWhileRevalidate : sert le cache
 *    immédiatement, revalide en tâche de fond.
 *
 * 3. Synchronisation en arrière-plan (Background Sync API) de la file
 *    d'attente IndexedDB. IMPORTANT — la Background Sync API n'est PAS
 *    supportée par Safari/iOS : elle est donc traitée ici comme un pur
 *    accélérateur (déclenche un envoi dès que le système le permet, même
 *    app fermée, sur les navigateurs qui la supportent), jamais comme le
 *    SEUL mécanisme de synchronisation. Le filet de sécurité universel est
 *    `useSyncManager` (src/hooks/useSyncManager.ts), qui fonctionne sur
 *    tous les navigateurs tant que l'app est ouverte.
 *
 * Mise à jour du Service Worker : PAS de `skipWaiting()` automatique. Un
 * agent peut avoir l'app ouverte pendant des heures sur le terrain avec des
 * pages en cours de saisie — forcer l'activation d'une nouvelle version au
 * mauvais moment casserait une session en cours. À la place, on notifie les
 * clients (voir `self.addEventListener("message", ...)`) et c'est l'UI qui
 * décide d'appliquer la mise à jour, au moment choisi par l'agent (voir
 * vite.config.ts : `registerType: "prompt"`).
 */
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { viderFile } from "./db/queueEmission";
import { viderFileControles } from "./db/queueControle";
import { synchroniserIndexVerification } from "./db/syncVerification";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// --- 1. Précache de l'app shell -------------------------------------------------------------

precacheAndRoute(self.__WB_MANIFEST);

// --- 2. Cache runtime des données de référence ------------------------------------------------

// Schémas de formulaire (Module Administration) : changent rarement — le cache
// sert en priorité, la revalidation se fait en tâche de fond.
registerRoute(
  ({ url }) => url.pathname.match(/^\/api\/v1\/formulaires\/[^/]+\/schema$/),
  new StaleWhileRevalidate({
    cacheName: "ppb-schemas-formulaire",
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  })
);

// Passeports préchargés : on préfère toujours la version la plus fraîche
// possible (NetworkFirst) puisqu'elle détermine ce qui est légitimement
// scannable — mais on retombe sur le cache si le réseau est absent.
registerRoute(
  ({ url }) => url.pathname === "/api/v1/passeports/cache-emission",
  new NetworkFirst({
    cacheName: "ppb-passeports-precharges",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 })],
  })
);

// Clé publique de vérification (Module 5) : ne change quasiment jamais —
// servie en priorité depuis le cache, revalidée en tâche de fond.
registerRoute(
  ({ url }) => url.pathname === "/api/v1/passeports/cle-publique",
  new StaleWhileRevalidate({
    cacheName: "ppb-cle-publique",
    plugins: [new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
);

// Index de vérification (Module 5) : IndexedDB (voir src/db/syncVerification.ts)
// reste la source de vérité pour la logique applicative (delta, dernier
// horodatage) — ce cache HTTP n'est qu'un filet de sécurité supplémentaire en
// cas d'échec d'écriture IndexedDB, jamais consulté directement par le code.
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/v1/controles/cache-verification"),
  new NetworkFirst({
    cacheName: "ppb-cache-verification",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 })],
  })
);

// Volontairement AUCUNE route de cache pour /api/v1/numerisations/* ni
// /api/v1/controles (POST) : les files d'attente IndexedDB sont l'unique
// mécanisme de fiabilisation de ces écritures — jamais le cache HTTP du
// navigateur.

// --- 3. Synchronisation en arrière-plan --------------------------------------------------------

const TAG_SYNC_NUMERISATIONS = "ppb-sync-numerisations";
const TAG_SYNC_CONTROLES = "ppb-sync-controles";
const TAG_SYNC_VERIFICATION = "ppb-sync-verification";

self.addEventListener("sync", (event) => {
  const evenementSync = event as unknown as { tag: string; waitUntil: (p: Promise<unknown>) => void };
  if (evenementSync.tag === TAG_SYNC_NUMERISATIONS) {
    evenementSync.waitUntil(viderFile());
  }
  if (evenementSync.tag === TAG_SYNC_CONTROLES) {
    evenementSync.waitUntil(viderFileControles());
  }
  if (evenementSync.tag === TAG_SYNC_VERIFICATION) {
    evenementSync.waitUntil(synchroniserIndexVerification());
  }
});

// --- Cycle de vie : mise à jour différée, jamais forcée ------------------------------------------

self.addEventListener("message", (event) => {
  if (event.data?.type === "APPLIQUER_MISE_A_JOUR") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
