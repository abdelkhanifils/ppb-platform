# Revue de sécurité — RBAC et signature numérique

Revue du mécanisme d'autorisation (RBAC, JWT) et du mécanisme de signature
numérique des passeports (Modules 3 et 5). Chaque constat est classé par
sévérité et par statut : **corrigé** (code modifié dans ce commit), **risque
accepté** (documenté, non corrigé — raison donnée), ou **recommandation**
(hors périmètre de cette revue, à traiter séparément).

---

## 1. RBAC — constats

### 1.1 [CORRIGÉ — Élevé] IDOR sur `POST /paiements/initier`

**Constat.** L'endpoint vérifiait le *rôle* de l'appelant (`ADMIN_NATIONAL`
ou `SUPER_ADMIN` via `require_roles`) mais jamais que la commande ciblée
appartenait à son propre pays. Un Admin National du Cameroun connaissant
l'`id` d'une commande tchadienne pouvait initier un paiement en ligne pour
cette commande — CinetPay aurait débité le montant, et l'attribution de
passeports tchadiens en aurait résulté, déclenchée par un utilisateur sans
lien avec ce pays.

**Correction.** Ajout de `require_same_country_or_super_admin(commande.pays_id,
current_user)` immédiatement après le chargement de la commande, avant toute
autre opération. Même correctif appliqué à `POST /paiements/presentiel` et
`GET /paiements/{commande_id}/moyens-disponibles` (ce dernier n'exigeait même
aucune authentification — voir 1.2).

**Test.** `tests/test_securite_rbac.py::test_initier_paiement_refuse_pour_commande_dun_autre_pays`,
`test_paiement_presentiel_refuse_pour_commande_dun_autre_pays`.

### 1.2 [CORRIGÉ — Moyen] `GET /paiements/{commande_id}/moyens-disponibles` sans authentification

**Constat.** Aucune dépendance `get_current_user` — l'endpoint était
accessible sans jeton, exposant le montant d'une commande à quiconque en
connaît l'id. Divulgation d'information à faible impact (pas de donnée
personnelle), mais incohérente avec le reste de l'API.

**Correction.** Authentification requise + même contrôle de périmètre pays
que 1.1.

### 1.3 [CORRIGÉ — Moyen] Absence de contrôle de périmètre sur `POST /numerisations/{passeport_id}/pages/{page_num}`

**Constat.** Un agent d'émission camerounais pouvait numériser un passeport
d'un autre pays s'il en connaissait (ou devinait) l'UUID. Risque
d'exploitation pratique faible (UUID v4, espace non énumérable), mais le
principe de moindre privilège doit être respecté indépendamment de la
difficulté d'exploitation — c'est une garantie défense-en-profondeur, pas
une mesure dimensionnée à la seule probabilité d'attaque.

**Correction.** `require_same_country_or_super_admin(passeport.pays_id,
current_user)` ajouté avant tout traitement.

### 1.4 [FORCE — À conserver] Rôle toujours dérivé de la base, jamais du JWT

**Constat (positif).** `get_current_user` recharge l'utilisateur depuis la
base à *chaque requête* et construit `CurrentUser.role` à partir de
`Utilisateur.role` (colonne base), jamais à partir de la revendication
`role` du JWT. Une désactivation de compte (`actif=False`) ou un changement
de rôle prend donc effet immédiatement, sans attendre l'expiration du jeton
d'accès (15 minutes) — la revendication `role` embarquée dans le JWT n'est
qu'une commodité pour l'UI cliente, jamais une source de vérité
d'autorisation. **Ne pas modifier ce comportement** : c'est la garantie qui
rend le reste du modèle RBAC fiable malgré la nature stateless des JWT.

### 1.5 [RISQUE ACCEPTÉ] Pas de révocation de jeton (JWT stateless)

**Constat.** Un jeton d'accès volé reste valide jusqu'à expiration naturelle
(15 minutes) ; un jeton de rafraîchissement volé, jusqu'à 7 jours, sans
mécanisme de révocation ni de rotation de famille.

**Justification de l'acceptation.** La fenêtre d'exposition du jeton d'accès
est courte (15 min) et bornée par construction. Le jeton de rafraîchissement
reste le point faible ; le corriger correctement (liste de révocation,
rotation avec détection de réutilisation) demande une infrastructure d'état
(Redis ou équivalent) hors du périmètre de cette revue.

**Recommandation.** Avant mise en production : (a) stocker un hash du jeton
de rafraîchissement en base avec un indicateur de révocation, vérifié à
`/auth/refresh` ; (b) invalider tous les jetons d'un utilisateur à la
désactivation de son compte ou au changement de mot de passe.

### 1.6 [RISQUE ACCEPTÉ] Pas de limitation de débit sur `/auth/login`

**Constat.** Aucun mécanisme anti-bruteforce sur la connexion.

**Recommandation.** Limitation de débit par IP et par compte au niveau du
reverse proxy (OVH) ou via `slowapi`/Redis avant mise en production.

### 1.7 [CORRIGÉ — Élevé, opérationnel] Absence de garde-fou contre les secrets par défaut en production

**Constat.** `JWT_SECRET` et `PSP_WEBHOOK_SECRET` ont des valeurs par défaut
documentées dans `.env.example` (`change-me-in-production`, `change-me`).
Rien n'empêchait un déploiement accidentel en production avec ces valeurs —
un `JWT_SECRET` connu permet de forger un jeton pour n'importe quel rôle,
`super_admin` inclus.

**Correction.** `app/core/startup_checks.py::verifier_secrets_production`,
appelée au démarrage de l'application (`lifespan`, `app/main.py`) : refuse de
démarrer si `ENVIRONMENT="production"` et qu'un secret a encore sa valeur par
défaut, ou si `JWT_SECRET` fait moins de 32 caractères. Sans effet en dehors
de la production (dev, test).

---

## 2. Signature numérique — constats

### 2.1 [FORCE — À conserver] Garde contre la génération automatique de clé en production

**Constat (positif).** `app/core/signing.py` refuse de générer une clé de
secours si `QR_SIGNING_KEY_PATH` est introuvable et `ENVIRONMENT="production"`
— la clé de la CEBEVIRHA doit être provisionnée explicitement. Seuls le
développement et les tests (avec clé éphémère isolée par test, voir
`tests/conftest.py::_cle_signature_isolee`) bénéficient de la génération
automatique.

### 2.2 [FORCE — À conserver] Format de signature ECDSA correctement géré de bout en bout

**Constat (positif).** La bibliothèque `cryptography` (backend) produit des
signatures ECDSA au format **DER** ; la Web Crypto API (frontend,
vérification hors-ligne) attend le format **raw** (IEEE P1363). Cette
divergence, souvent source de vérifications qui échouent silencieusement
même pour une signature authentique, est explicitement gérée par
`frontend/src/services/verificationSignature.ts::derVersRaw`. **Point de
vigilance pour toute évolution future** : ne jamais modifier l'un des deux
côtés (génération backend, conversion frontend) sans l'autre.

### 2.3 [VÉRIFIÉ — Pas de vulnérabilité] Absence de risque de collision dans la chaîne canonique

**Constat.** `construire_chaine_canonique` concatène
`numero_pays-numero_annee-numero_lot-qr_uuid` sans préfixe de longueur.
Une concaténation sans délimitation stricte peut en général créer des
collisions (ex. `"ab"+"c"` == `"a"+"bc"`). **Analyse** : chaque composant a
une longueur fixe et non contrôlée par un tiers (2, 4, 7 chiffres, UUID à
36 caractères à positions de tiret fixes), donc aucune ambiguïté n'est
possible dans la pratique. Documenté explicitement dans le code pour éviter
qu'une évolution future (ex. rendre `numero_lot` de longueur variable) ne
réintroduise le risque sans que quiconque s'en aperçoive.

### 2.4 [RISQUE ACCEPTÉ] Pas de rotation de clé de signature versionnée

**Constat.** Si la CEBEVIRHA doit un jour changer de clé de signature (fuite,
migration d'algorithme), les passeports déjà émis avec l'ancienne clé
deviendraient invérifiables : `GET /passeports/cle-publique` ne sert qu'UNE
clé publique courante, sans notion d'historique.

**Justification de l'acceptation.** Le mécanisme de rotation de clé
(archivage des anciennes clés publiques indexées par une identité de clé
embarquée dans chaque signature) demande un changement de schéma
(`Passeport.id_cle_signature` ou équivalent) qui dépasse le périmètre de
cette revue.

**Recommandation.** Avant toute rotation de clé réelle : introduire un
identifiant de clé (`kid`) dans le calcul de signature et publier
`GET /passeports/cles-publiques` (pluriel), indexé par `kid`, jamais un seul
endpoint à clé unique.

### 2.5 [VÉRIFIÉ — Pas de vulnérabilité] Confusion d'algorithme non exploitable

**Constat.** `verifier()` (backend) et l'équivalent frontend décident de
l'algorithme de vérification (ECDSA vs RSA) selon le *type* de la clé
publique chargée — jamais selon une donnée fournie par l'appelant. Comme la
clé provient d'un fichier provisionné par la CEBEVIRHA (jamais d'une entrée
utilisateur), une attaque par confusion d'algorithme (substituer une clé
faible pour contourner la vérification) n'a pas de surface d'exploitation
ici.

---

## 3. TexteGabarit — workflow à deux comptes (revue du mécanisme existant)

Le circuit était déjà implémenté (proposition, validation, rejet, garde
« le proposant ne peut pas valider sa propre proposition »). Deux bugs
identifiés et corrigés dans ce commit :

- **Absence de garde d'état** : un texte déjà `VALIDE` ou `REJETE` pouvait
  être revalidé ou rerejeté sans contrôle — corrigé (`statut != PROPOSE`
  refuse désormais avec 409).
- **Incrémentation de version incohérente** : `gabarit_version += 1` à la
  validation pouvait désynchroniser plusieurs textes proposés ensemble pour
  une même nouvelle version selon l'ordre de leur validation. Corrigé : la
  version est désormais figée dès la proposition
  (`gabarit_version_courante`, choisie par le proposant) et n'est plus
  modifiée à la validation.
- **Limite documentée, non corrigée** : rien n'empêche de référencer une
  `gabarit_version` partiellement validée (certains textes `VALIDE`,
  d'autres encore `PROPOSE`) dans une `AutorisationImpression` ou une
  attribution. Un nouvel endpoint de diagnostic,
  `GET /admin/gabarit/{version}/completion`, permet à l'administrateur de
  vérifier la complétude avant utilisation — mais rien ne l'impose au niveau
  base. Une garantie stricte demanderait une entité de « lot » regroupant
  les textes d'une version, hors périmètre de cette revue.

**Tests.** `tests/test_gabarit_workflow.py` (8 scénarios).

---

## 4. Résumé

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| 1.1 | IDOR — initiation de paiement cross-pays | Élevée | Corrigé |
| 1.2 | Endpoint moyens-disponibles sans authentification | Moyenne | Corrigé |
| 1.3 | IDOR — numérisation cross-pays | Moyenne | Corrigé |
| 1.4 | Rôle dérivé de la base, jamais du JWT | — | Force (conserver) |
| 1.5 | Pas de révocation de jeton | Moyenne | Risque accepté |
| 1.6 | Pas de rate-limiting sur /auth/login | Moyenne | Risque accepté |
| 1.7 | Secrets par défaut non bloqués en production | Élevée | Corrigé |
| 2.1 | Garde clé de signature dev/prod | — | Force (conserver) |
| 2.2 | Conversion DER->raw ECDSA | — | Force (conserver) |
| 2.3 | Collision de chaîne canonique | — | Vérifié, non exploitable |
| 2.4 | Pas de rotation de clé versionnée | Moyenne | Risque accepté |
| 2.5 | Confusion d'algorithme | — | Vérifié, non exploitable |
| 3 | TexteGabarit — garde d'état + version incohérente | Moyenne | Corrigé |

**Fichiers modifiés** : `app/api/v1/endpoints/paiements.py`,
`app/api/v1/endpoints/numerisations.py`, `app/api/v1/endpoints/admin.py`,
`app/schemas/admin.py`, `app/core/startup_checks.py` (nouveau), `app/main.py`.
Tests : `tests/test_securite_rbac.py`, `tests/test_gabarit_workflow.py`.
