# --- Étape 1 : construire le site (transformer le code en fichiers prêts à afficher) ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

# --- Rupture de cache, volontaire ---
# Voir mobile/Dockerfile pour l'historique complet de ce mécanisme (déjà
# rencontré là-bas : Railway peut réutiliser un cache de build périmé
# malgré un vrai push de code modifié). Repris ici par prudence, même
# application PWA (voir public/serve.json plus bas).
ARG RAILWAY_GIT_COMMIT_SHA
ARG CACHE_BUST_MANUEL=2026-09-05-02
RUN echo "Build — commit ${RAILWAY_GIT_COMMIT_SHA:-inconnu}, repère manuel ${CACHE_BUST_MANUEL}"

COPY . .

# IMPORTANT : Vite "grave" cette adresse dans les fichiers au moment de la
# construction — la changer après coup (juste en variable d'environnement)
# n'a aucun effet. Il faut la fournir ICI, au moment du build.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# --- Étape 2 : servir les fichiers construits ---
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve

COPY --from=build /app/dist ./dist

# IMPORTANT — voir public/serve.json (copié tel quel dans dist/ par Vite) :
# force sw.js, registerSW.js, manifest.webmanifest et index.html à ne
# JAMAIS être mis en cache par le navigateur. Sans ça, un navigateur qui a
# déjà mis sw.js en cache HTTP ne le re-télécharge parfois pas avant
# plusieurs heures — la PWA continue alors de tourner sur l'ancien code
# malgré un déploiement réussi. Piège classique et documenté des PWA avec
# Workbox — voir mobile/Dockerfile pour le détail complet.

# Railway choisit lui-même le port via la variable $PORT — on l'utilise tel quel.
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
