# Déployer sur Railway — guide très simple, étape par étape

Ce guide suppose que vous ne connaissez rien à Railway. Chaque étape est
courte. Ne sautez aucune étape, même si elle paraît évidente.

Votre projet a **3 morceaux** à installer sur Railway :
1. 🗄️ La **base de données** (là où toutes les informations sont rangées)
2. ⚙️ Le **backend** (le "cerveau" — `backend/`)
3. 🖥️ Le **frontend** (le site qu'on voit — `frontend/`)

Chaque morceau est un « service » séparé, dans le même « projet » Railway.

---

## Étape 0 — Avant de commencer

Il vous faut :
- Un compte **GitHub** (gratuit) — c'est là que votre code doit vivre.
- Le code du projet **poussé sur GitHub** (dans un dépôt, public ou privé).

Si votre code n'est pas encore sur GitHub :
1. Allez sur [github.com](https://github.com), connectez-vous.
2. Cliquez sur le bouton vert **"New"** (nouveau dépôt).
3. Donnez-lui un nom, par exemple `ppb-platform`. Laissez le reste par défaut. Cliquez **"Create repository"**.
4. Sur votre ordinateur, dans le dossier du projet, tapez ces commandes une par une :
   ```
   git init
   git add .
   git commit -m "Premier envoi"
   git branch -M main
   git remote add origin https://github.com/VOTRE-NOM/ppb-platform.git
   git push -u origin main
   ```
   (remplacez `VOTRE-NOM` par votre nom d'utilisateur GitHub)

---

## Étape 1 — Créer un compte Railway

1. Allez sur [railway.com](https://railway.com).
2. Cliquez **"Login"** puis **"Login with GitHub"**.
3. Autorisez Railway à accéder à votre compte GitHub.

---

## Étape 2 — Créer un nouveau projet

1. Une fois connecté, cliquez **"New Project"** (gros bouton, en haut).
2. Choisissez **"Empty Project"** (projet vide).
3. Donnez-lui un nom si demandé, par exemple `ppb-platform`.

Vous arrivez sur un grand écran vide : c'est votre "canvas" (tableau). C'est ici qu'on va poser les 3 morceaux.

---

## Étape 3 — Ajouter la base de données 🗄️

1. Sur le canvas, cliquez **"+ New"** (ou **"+ Create"**).
2. Choisissez **"Database"** → **"Add PostgreSQL"**.
3. Railway installe la base tout seul. Une petite carte "Postgres" apparaît sur le canvas. C'est fait, ne touchez plus à rien ici.

> 💡 Cette base standard suffit très bien pour commencer et tester. Une
> option plus avancée (PostGIS, pour les cartes) existe — voir tout en bas
> de ce guide, "Pour aller plus loin".

---

## Étape 4 — Ajouter le backend ⚙️

1. Sur le canvas, cliquez **"+ New"** → **"GitHub Repo"**.
2. Choisissez votre dépôt `ppb-platform`.
3. Railway crée un nouveau service. Cliquez dessus pour l'ouvrir.
4. Allez dans l'onglet **"Settings"** de ce service.
5. Cherchez **"Root Directory"** (dossier racine) et écrivez : `backend`
   (ça dit à Railway : "ce service, c'est le dossier `backend/`, pas tout le projet").
6. Railway va détecter le `Dockerfile` tout seul et s'en servir pour construire le service.

---

## Étape 5 — Donner ses codes secrets au backend

Toujours dans ce service backend :

1. D'abord, allez voir le nom exact de votre service de base de données :
   - Sur le canvas du projet, regardez la carte de la base de données.
   - Son nom est écrit dessus — normalement **"Postgres"**. Si c'est écrit différemment chez vous, notez le nom exact (respectez les majuscules).

2. Retournez dans le service **backend** → onglet **"Variables"** → **"Raw Editor"**.
3. Collez tout ceci ensemble (secrets + base de données) :

```
ENVIRONMENT=production
JWT_SECRET=<inventez une longue phrase secrète, 40 caractères minimum, jamais devinable>
CORS_ORIGINS=["*"]
DATABASE_URL=postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
DATABASE_URL_SYNC=postgresql://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
```

> 💡 **Comment ça marche** : `${{Postgres.PGUSER}}` n'est pas une vraie
> valeur — c'est une formule. Elle dit à Railway : *"va chercher la variable
> PGUSER dans le service qui s'appelle Postgres, et mets sa valeur ici"*.
> Railway remplace automatiquement les 5 formules (`PGUSER`, `PGPASSWORD`,
> `PGHOST`, `PGPORT`, `PGDATABASE`) par les vraies informations de connexion
> de votre base — vous n'avez jamais besoin de les recopier à la main, ni de
> connaître une adresse IP. Si le nom de votre service de base de données
> n'est pas "Postgres" (vu à l'étape 1 ci-dessus), remplacez `Postgres` par
> ce nom exact dans les deux lignes `DATABASE_URL`.
>
> Notre backend a besoin de deux versions très proches de la même adresse
> (`DATABASE_URL` et `DATABASE_URL_SYNC`) — seule la toute première partie
> change (`postgresql+asyncpg://` contre `postgresql://`), c'est normal,
> ne cherchez pas à les rendre identiques.

> 💡 Le paiement en ligne (CinetPay) n'est pas activé dans cette version —
> vos identifiants n'étaient pas encore prêts. Pas de variable à ajouter
> pour ça. Seul le paiement présentiel/virement fonctionne pour l'instant
> (validé manuellement par un compte Super Admin). Voir le README, section
> "Réactiver CinetPay", le jour où vous aurez ces identifiants.

4. Cliquez **"Deploy"** en haut pour relancer avec ces nouvelles variables.

---

## Étape 6 — Donner une adresse publique au backend

1. Dans le service backend, allez dans **"Settings"** → **"Networking"**.
2. Cliquez **"Generate Domain"**.
3. Railway vous donne une adresse du genre `ppb-backend-production.up.railway.app`.
4. **Notez cette adresse quelque part** — vous en aurez besoin dans 2 minutes.

---

## Étape 7 — Préparer la base de données (une seule fois)

Il faut créer les "tiroirs" dans la base (les tables) et y mettre les données de départ (les 6 pays, les comptes de test).

1. Dans le service backend, allez dans l'onglet **"Deployments"**.
2. Ouvrez le déploiement le plus récent, cliquez sur les **3 petits points** → cherchez une option du genre **"Shell"** ou **"Run Command"**.
   - Si vous ne trouvez pas cette option facilement, la manière la plus fiable est d'installer l'outil Railway sur votre ordinateur :
     ```
     npm install -g @railway/cli
     railway login
     railway link
     ```
     (`railway link` vous demande de choisir votre projet — choisissez-le)
3. Une fois connecté au bon service (backend), tapez :
   ```
   railway run alembic revision --autogenerate -m "schema initial"
   railway run alembic upgrade head
   railway run python -m app.db.seed
   ```
4. Si tout se passe bien, le dernier message ressemble à :
   `Amorçage terminé — 6 pays, 6 comptes...`

C'est fait. La base est prête, une seule fois.

---

## Étape 8 — Ajouter le frontend 🖥️

1. Retournez sur le canvas du projet (bouton retour, ou logo Railway en haut à gauche).
2. Cliquez **"+ New"** → **"GitHub Repo"** → même dépôt `ppb-platform`.
3. Ouvrez ce nouveau service → **"Settings"**.
4. **"Root Directory"** : écrivez `frontend`.

---

## Étape 9 — Donner l'adresse du backend au frontend

1. Dans ce service frontend, onglet **"Variables"**.
2. Ajoutez :
   ```
   VITE_API_BASE_URL=https://ADRESSE-DU-BACKEND-NOTEE-A-LETAPE-6/api/v1
   ```
   (remplacez par l'adresse notée à l'étape 6, avec `https://` devant et `/api/v1` derrière)
3. ⚠️ Cette variable doit être présente **avant** le premier déploiement du frontend, car elle est "gravée" dans le site au moment de sa construction (voir la remarque dans `frontend/Dockerfile`). Si vous l'ajoutez après coup, il faut relancer un déploiement (bouton **"Redeploy"**) pour qu'elle soit prise en compte.

---

## Étape 10 — Donner une adresse publique au frontend

1. **"Settings"** → **"Networking"** → **"Generate Domain"**.
2. Railway vous donne une adresse, par exemple `ppb-frontend-production.up.railway.app`.

---

## Étape 11 — Mettre à jour le backend avec l'adresse du frontend

Le backend doit savoir que le frontend a le droit de lui parler (règle de sécurité appelée CORS).

1. Retournez dans le service **backend** → **"Variables"**.
2. Remplacez `CORS_ORIGINS=["*"]` par :
   ```
   CORS_ORIGINS=["https://ADRESSE-DU-FRONTEND"]
   ```
3. Redéployez le backend.

---

## Étape 12 — Tester ! 🎉

1. Ouvrez l'adresse du **frontend** dans votre navigateur.
2. Vous devez voir l'écran de connexion.
3. Connectez-vous avec un compte de test créé à l'étape 7, par exemple :
   - Email : `superadmin@cebevirha.org`
   - Mot de passe : `ChangeMoi!2026`
4. **Changez ce mot de passe immédiatement** si ce déploiement doit rester en ligne au-delà d'un test rapide.

Si l'écran de connexion ne s'affiche pas, ou si la connexion échoue :
- Ouvrez `https://ADRESSE-DU-BACKEND/api/v1/docs` dans le navigateur — si ça affiche une page de documentation, le backend fonctionne, le souci vient du frontend (vérifiez `VITE_API_BASE_URL`, étape 9).
- Si ça n'affiche rien, regardez l'onglet **"Deployments"** du service backend, cliquez sur le déploiement, et lisez les **"Logs"** (le journal) pour voir le message d'erreur exact.

---

## Pour aller plus loin (facultatif)

- **PostGIS** (pour que la carte du tableau de bord fonctionne avec de vrais
  calculs géographiques, pas juste une approximation) : à l'étape 3, au lieu
  d'"Add PostgreSQL", choisissez **"Empty Service"** → **"Deploy a Docker
  Image"** → tapez `postgis/postgis:16-3.4`. Le reste du guide ne change pas.
- **Nom de domaine personnalisé** (ex. `ppb.cebevirha.org` au lieu de
  `...up.railway.app`) : `Settings` → `Networking` → `Custom Domain`.
- **Paiement en ligne (CinetPay)** : voir le README, section "Réactiver
  CinetPay", une fois vos identifiants obtenus.
