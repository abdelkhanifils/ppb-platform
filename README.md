# Plateforme numérique du Passeport Pour Bétail (PPB) — CEBEVIRHA

Initialisation de la structure du projet **FastAPI (backend) + React/TypeScript (frontend)**,
conforme au [Document de conception](#) (diagramme de classes, cas d'utilisation, séquences)
et au [Document technique d'implémentation](#) (Modules Commande, Paiement, Impression, Scan,
Contrôle, Administration, Statistiques) — AMI/CEBEVIRHA/FLUVIAC/PPB/2026.

## Architecture technique de référence

| Composant | Technologie |
|---|---|
| Frontend Web | React.js + TypeScript + Tailwind (+ shadcn/ui à intégrer) |
| Backend API | Python (FastAPI), API REST versionnée `/api/v1/` |
| Base de données | PostgreSQL + PostGIS |
| Authentification | **JWT + bcrypt + RBAC (6 rôles)** |
| Application terrain | PWA, IndexedDB, Service Worker |
| QR Code | qrcode.react (génération) + html5-qrcode (lecture) |
| Signature numérique | RSA-2048 ou ECDSA P-256 |
| Cartographie | Leaflet.js + OpenStreetMap |
| Paiement en ligne | *Retiré temporairement — voir section dédiée plus bas* |

## Les 6 rôles RBAC

Définis dans `backend/app/core/rbac.py` (source de vérité) et reflétés côté frontend dans
`frontend/src/types/roles.ts` :

1. **super_admin** — Super Administrateur CEBEVIRHA
2. **admin_national** — Ministère de l'Élevage (par pays)
3. **agent_emission** — Agent d'émission terrain (+ paiement présentiel, en pratique confié au Super Admin)
4. **agent_controle** — Agent de contrôle aux postes frontière
5. **veterinaire** — Vétérinaire (validation sanitaire)
6. **consultation** — Lecture seule (statistiques, audits)

## Démarrage rapide

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
docker compose up --build
```

- API : http://localhost:8000/api/v1/docs (OpenAPI/Swagger)
- Frontend : http://localhost:5173

### Sans Docker

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic revision --autogenerate -m "schema initial"
alembic upgrade head
python -m app.db.seed          # 6 pays CEMAC + 1 compte par rôle (mot de passe : ChangeMoi!2026)
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Structure du dépôt

```
ppb-platform/
├── backend/
│   ├── app/
│   │   ├── core/          # config, sécurité JWT, RBAC (6 rôles)
│   │   ├── db/            # session async, Base déclarative, seed
│   │   ├── models/        # 17 entités du diagramme de classes (SQLAlchemy)
│   │   ├── schemas/       # Pydantic (entrée/sortie API)
│   │   └── api/v1/
│   │       ├── deps.py    # get_current_user, require_roles(...)
│   │       └── endpoints/ # auth, commandes, paiements, passeports,
│   │                      # numerisations, controles, admin, statistiques
│   ├── alembic/           # migrations
│   └── requirements.txt
└── frontend/
    └── src/
        ├── api/client.ts          # Axios + injection JWT + refresh auto
        ├── contexts/AuthContext.tsx
        ├── components/ProtectedRoute.tsx   # garde RBAC par route
        ├── layouts/TableauDeBordLayout.tsx # nav filtrée par rôle
        ├── pages/                          # un écran par module
        └── types/roles.ts
```

## Ce qui est fonctionnel dès l'initialisation

- **Authentification JWT complète** : login, refresh automatique (access 15 min / refresh 7 jours),
  hachage bcrypt (coût 12).
- **RBAC appliqué** sur chaque route sensible, backend (`require_roles`) et frontend (`ProtectedRoute`).
- **Module 1 — Commande** entièrement implémenté (référence de pattern pour les autres modules) :
  création, consultation, modification avant paiement, vérification de l'AutorisationImpression
  avant d'proposer le mode décentralisé.
- **Modèle de données complet** (17 entités, dont le couple Éleveur/Convoyeur/Troupeau/Vaccination/
  Itineraire tel que créé par le Module 4, et le mécanisme de configuration dynamique
  DefinitionFormulaire/DefinitionChamp/Parametre/TexteGabarit).
- Routeurs des Modules 2 à 5, Administration et Statistiques : routes, RBAC et règles de garde
  (plafond de paiement, plage fermée d'impression, principe des « quatre yeux », repli papier si
  itinéraire non synchronisé) posés ; logique métier fine marquée `# TODO` où elle dépend de
  composants encore à construire (génération PDF, signature RSA/ECDSA, OCR).

## Paiement en ligne — retiré temporairement (identifiants CinetPay pas encore prêts)

Le paiement en ligne (CinetPay) a été retiré de cette version : les
identifiants (apikey, site_id, secret webhook) n'étaient pas disponibles au
moment du déploiement. **Seul le paiement présentiel/virement fonctionne**
(`POST /paiements/presentiel` puis validation par un Super Admin) — c'est ce
chemin qui déclenche l'attribution automatique des passeports, exactement
comme le ferait une confirmation CinetPay.

### Réactiver CinetPay plus tard

Le code retiré (client CinetPay, vérification de signature webhook,
réconciliation active, tests associés) reste consultable dans l'historique
Git de ce dépôt, à un commit antérieur à son retrait. Pour le réintégrer :

1. Récupérer `app/services/cinetpay.py` et `app/services/reconciliation.py`
   depuis cet historique.
2. Réajouter dans `app/api/v1/endpoints/paiements.py` les endpoints
   `POST /initier`, `POST /webhook`, `POST /reconciliation/executer`.
3. Réajouter les colonnes `reference_psp`, `payment_token`,
   `tentatives_reconciliation` au modèle `Paiement`
   (`app/models/paiement.py`) et générer une migration Alembic.
4. Réajouter les variables `CINETPAY_*`, `PSP_WEBHOOK_SECRET`,
   `RECONCILIATION_*` dans `app/core/config.py` et `.env.example`.
5. Réajouter `app/core/scheduler.py` et son branchement dans `app/main.py`
   (`demarrer_scheduler`/`arreter_scheduler`).
6. Renseigner `backend/.env` avec les identifiants de test CinetPay — pas de
   "sandbox" séparée chez CinetPay, mêmes points d'entrée que la production,
   c'est le statut du compte marchand qui distingue les deux.

## Module 4 — PWA d'émission : Service Worker et IndexedDB



`frontend/src/sw.ts` (Service Worker personnalisé, stratégie `injectManifest`
— voir `vite.config.ts`) et `frontend/src/db/` (IndexedDB via `idb`) :

- **Précache de l'app shell uniquement** (JS/CSS/HTML, via `workbox-precaching`)
  — aucune donnée métier n'est mise en cache HTTP. Le cache runtime
  (`StaleWhileRevalidate`/`NetworkFirst`) ne couvre que les GET de référence
  (`/formulaires/{code}/schema`, `/passeports/cache-emission`).
- **Sans conservation d'image, structurellement** : IndexedDB ne compte que
  5 object stores (`passeports_precharges`, `schemas_formulaire`,
  `file_synchronisation`, `numerisations_confirmees`, `parametres_locaux`),
  aucun ne stockant de Blob ni de photo — la page 1 (vérification visuelle)
  ne produit d'ailleurs aucune donnée, seul son franchissement est acté.
- **File de synchronisation** (`db/queueEmission.ts`) — chaque page validée
  par l'agent est écrite en local de façon synchrone et fiable ; l'envoi au
  serveur est ensuite tenté par deux mécanismes complémentaires :
  - `useSyncManager` (app ouverte, tous navigateurs) — écoute `online` +
    repli périodique 30 s ;
  - Background Sync API côté `sw.ts` (best-effort, app fermée) — **absente
    de Safari/iOS**, donc jamais le seul mécanisme.
- **Mise à jour du Service Worker jamais forcée** (`registerType: "prompt"`)
  — un agent en session de saisie ne doit jamais voir son travail interrompu
  par une mise à jour ; un bandeau (`BandeauMiseAJour.tsx`) laisse l'agent
  choisir le moment.
- **Formulaire dynamique** (`components/emission/FormulaireDynamique.tsx`) —
  généré depuis `GET /formulaires/{code}/schema` (Module Administration),
  offline-first (cache IndexedDB lu en premier, réseau en tâche de fond).
  Page 3 (Éleveur/Convoyeur/Itinéraire) et Page 4 (composition du troupeau
  par espèce + vaccinations) combinent champs structurels fixes et champs
  dynamiques — voir `pages/emission/`.

**Point d'attention pour la suite** : `POST /numerisations/{id}/pages/{n}`
attend le corps JSON brut (`dict | None` non enveloppé, non `embed`) — le
frontend en tient compte explicitement (voir le commentaire dans
`queueEmission.ts`), mais faire évoluer cet endpoint vers un modèle Pydantic
explicite (`{"donnees_json": ...}`) le rendrait moins fragile à ce genre de
convention implicite.

## Module 5 — Contrôle : synchronisation différentielle, vérification hors-ligne, conformité

**Backend**
- `app/services/emission.py` : crée réellement Éleveur, Convoyeur, Itinéraire
  (page 3) et Troupeau/TroupeauEspece/Vaccination (page 4) à la complétion des
  4 pages — ce `TODO` historique est levé. Idempotent : rejouer une page déjà
  transmise (retour réseau perdu côté client) ne recrée jamais les entités.
- `Itineraire.publie_le` : horodaté à la création, symétrique de
  `Passeport.publie_le` (Module 3) — alimente la synchronisation différentielle.
- `GET /controles/cache-verification/delta?depuis=` et `GET
  /controles/cache-verification` : renvoient désormais réellement les
  itinéraires (plus un stub vide), filtrés par `publie_le`.
- `POST /controles` : revérifie la signature numérique en ligne (même chaîne
  canonique, même clé publique que la vérification hors-ligne) et applique la
  conformité au trajet déclaré (pays de l'agent = origine OU destination de
  l'itinéraire — simplification documentée en l'absence de référentiel des
  postes). Une signature invalide est rédhibitoire, sans même consulter
  l'itinéraire.

**Frontend — application de contrôle** (base IndexedDB `ppb-controle`,
indépendante de `ppb-emission`) :
- `hooks/useDeltaSync.ts` : synchronisation automatique (descente index de
  vérification + clé publique, montée contrôles en attente) dès détection
  réseau — jamais une action de l'agent, comme l'exige le document technique.
- `services/verificationSignature.ts` : vérification par Web Crypto API
  (`SubtleCrypto`), entièrement hors-ligne. Piège explicitement traité : les
  signatures ECDSA produites par `cryptography` (backend) sont au format
  **DER**, la Web Crypto API attend le format **raw** (IEEE P1363) — la
  conversion est implémentée dans `derVersRaw`.
- `services/conformiteItineraire.ts` : reproduit à l'identique la logique
  backend, pour un résultat immédiat côté terrain.
- `db/queueControle.ts` : les contrôles enregistrés hors-ligne sont mis en
  file puis remontés au serveur best-effort — la décision affichée à l'agent
  ne dépend jamais de cette remontée.

## Module 3 — Numérotation, QR Code, signature numérique

`app/services/attribution.py` orchestre l'attribution automatique déclenchée
en interne par le Module 2 (validation d'un paiement présentiel — jamais un
appel client direct) :

- **Numérotation** — `app/models/passeport.py::CompteurNumerotation`, une
  ligne par (pays, année), réservée via `SELECT ... FOR UPDATE` sur
  PostgreSQL (no-op inoffensif ailleurs) pour garantir qu'aucune plage n'est
  distribuée deux fois entre attributions concurrentes.
- **QR Code** — UUID par passeport + `app/services/qrcode_service.py`
  (génération PNG à la demande, `GET /passeports/{id}/qrcode`).
- **Signature numérique** — `app/core/signing.py`, RSA-2048 ou ECDSA P-256
  (détecté depuis la clé chargée). Signe l'empreinte SHA-256 d'une chaîne
  canonique `pays-annee-lot-qr_uuid`, jamais la donnée brute. La clé privée
  n'est **jamais** générée automatiquement en production (`ErreurSignature`
  si absente) ; en développement/tests, une clé ECDSA éphémère est générée
  pour ne pas bloquer le travail local. Clé publique exposée sans
  authentification sur `GET /passeports/cle-publique` — jamais la privée.
- **Publication vers l'index de vérification (Module 5)** —
  `Passeport.publie_le`, horodaté dans la même transaction que
  l'attribution. `GET /controles/cache-verification/delta?depuis=` et
  `GET /controles/cache-verification` s'appuient dessus. Rejeu manuel
  (ops) : `POST /passeports/sync/publier-nouveaux-passeports` (Super Admin).
- **Impression décentralisée** — `POST /passeports/autorisations-impression`
  (Super Admin, refuse tout chevauchement de plage), `POST
  .../{id}/suspendre` (droit de suspension immédiat), `POST
  /passeports/impression-decentralisee/declarer` (plage fermée, refuse tout
  numéro manquant ou déjà imprimé avant la moindre écriture).
- **Impression centralisée** — `POST /passeports/impression-centralisee/confirmer`.

## Sécurité et plan de tests

- `SECURITY_REVIEW.md` — revue du RBAC et de la signature numérique :
  constats, correctifs appliqués (dont deux IDOR corrigés), risques acceptés
  documentés.
- `E2E_TEST_PLAN.md` — catalogue de 19 scénarios end-to-end par module ; 11
  sont implémentés (`backend/tests/test_e2e_parcours_complet.py`).

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest -v
```

Les tests tournent sur SQLite en mémoire (aucune base PostgreSQL requise) :
`tests/conftest.py` substitue `get_db` et amorce une base fraîche à chaque
test. `tests/test_commandes_api.py` couvre le Module 1 de bout en bout via
le client HTTP (RBAC, isolation par pays, bornes de quantité paramétrables,
garde-fou AutorisationImpression, verrou de modification après paiement) ;
`tests/test_commandes_service.py` teste unitairement la règle d'expiration
à 30 jours, indépendamment de la couche HTTP.

## Prochaines étapes suggérées

1. Générer la première migration Alembic et amorcer la base (`python -m app.db.seed`).
2. Réintégrer le paiement en ligne CinetPay une fois les identifiants disponibles
   (voir section « Paiement en ligne — retiré temporairement » plus haut).
3. Ajouter shadcn/ui aux pages frontend et implémenter les écrans (actuellement des placeholders
   dont le routage et la garde RBAC sont déjà branchés).
4. Écrire les tests selon le plan de tests par module (Document technique, section 8).
