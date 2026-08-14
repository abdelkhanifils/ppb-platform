# --- Étape 1 : construire le site (transformer le code en fichiers prêts à afficher) ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

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

# Railway choisit lui-même le port via la variable $PORT — on l'utilise tel quel.
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
