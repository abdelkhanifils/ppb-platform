# --- Recette de construction de la PWA « PPB Émission » pour Railway ---
#
# Railway ne sait pas deviner comment construire une application : ce fichier
# le lui explique. Il y a DEUX temps, et c'est volontaire :
#
#   1. On construit le site (transformer le code en fichiers affichables).
#   2. On jette tout ce qui a servi à construire, et on ne garde que le
#      résultat. L'image finale est donc légère, et elle ne contient aucun
#      outil de développement.

# --- Temps 1 : construire ---
FROM node:20-alpine AS build
WORKDIR /app

# `corepack` fournit pnpm, le gestionnaire de paquets utilisé par ce projet.
RUN corepack enable

COPY package.json pnpm-lock.yaml ./

# On installe d'abord à l'identique du verrou (`--frozen-lockfile`), qui
# garantit exactement les mêmes versions qu'en développement. Si la version de
# pnpm de Railway diffère et refuse le verrou, on retombe sur une installation
# normale plutôt que de faire échouer tout le déploiement.
RUN pnpm install --frozen-lockfile || pnpm install

# --- Rupture de cache, volontaire ---
# Railway a déjà, une fois, réutilisé un cache de build périmé malgré un
# vrai push de code modifié (fichier JavaScript final resté identique,
# empreinte de nom de fichier Vite inchangée, malgré des commits différents
# et des durées de build normales) — aucune option "Redeploy without cache"
# n'est proposée dans l'interface standard. Les deux lignes suivantes
# forcent Docker à tout reconstruire à partir d'ici à CHAQUE build :
#
# 1. RAILWAY_GIT_COMMIT_SHA change automatiquement à chaque commit (fourni
#    par Railway) — solution automatique, si Railway la peuple bien pour ce
#    service.
# 2. CACHE_BUST_MANUEL est un repli garanti à 100% : changez simplement ce
#    numéro (n'importe quelle valeur différente suffit) si un déploiement
#    semble à nouveau bloqué sur d'anciens fichiers malgré un push réel.
ARG RAILWAY_GIT_COMMIT_SHA
ARG CACHE_BUST_MANUEL=2026-08-22-02
RUN echo "Build — commit ${RAILWAY_GIT_COMMIT_SHA:-inconnu}, repère manuel ${CACHE_BUST_MANUEL}"

COPY . .

# IMPORTANT : Vite « grave » cette adresse dans les fichiers AU MOMENT de la
# construction. La modifier ensuite dans Railway n'a aucun effet tant qu'un
# nouveau déploiement n'a pas été lancé (bouton « Redeploy »).
#
# Elle est facultative : sans elle, l'application utilise l'adresse de la
# plateforme centrale déjà inscrite dans le code, et l'agent peut de toute
# façon la corriger depuis l'écran Réglages.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm run build

# --- Temps 2 : servir les fichiers construits ---
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve

COPY --from=build /app/dist ./dist

# `-s` (single-page) renvoie index.html pour toute adresse inconnue : sans lui,
# ouvrir directement une fiche comme /emission/12 donnerait une erreur 404,
# car ces adresses n'existent que dans le navigateur, pas sur le serveur.
#
# Railway impose son propre port via la variable $PORT : on l'utilise tel quel.
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]