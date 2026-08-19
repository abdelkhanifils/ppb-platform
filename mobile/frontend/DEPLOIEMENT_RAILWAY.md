# Déployer — guide pas à pas, très simple

Ce guide fait DEUX choses, dans cet ordre. Ne les mélangez pas.

- **Partie A** — mettre à jour la plateforme centrale (le « cerveau »), pour que
  la consultation des données fonctionne. C'est obligatoire cette fois.
- **Partie B** — mettre l'application mobile en ligne sur Railway, pour que les
  agents l'installent sur leur téléphone.

Avant de commencer, une chose à comprendre, et c'est la source de presque
toutes les confusions :

> **Railway ne lit pas votre ordinateur. Railway lit GitHub.**
>
> Modifier un fichier chez vous ne change rien en ligne. Il faut envoyer
> (« pousser ») le fichier sur GitHub ; Railway le voit alors et reconstruit
> tout seul. Le bouton « Restart » de Railway ne fait que rallumer le MÊME
> code : il ne peut donc jamais apporter une nouveauté.

---

# Partie A — Mettre à jour la plateforme centrale

## A1. Récupérer les fichiers modifiés

Deux fichiers ont changé côté plateforme centrale :

- `backend/app/api/v1/endpoints/numerisations.py` — la route de consultation
  renvoie maintenant les valeurs saisies aux pages 3 et 4. **C'est ce fichier
  qui rend la consultation possible.** Sans lui, l'écran de consultation ne
  pourra jamais afficher ce qui est en base.
- `backend/scripts/reinitialiser_super_admin.py` — filet de sécurité pour
  retrouver l'accès administrateur (facultatif, mais autant l'envoyer aussi).

Copiez-les dans votre dossier de projet, **au même emplacement exact**.

## A2. Les envoyer sur GitHub

Ouvrez un terminal dans votre dossier de projet, et tapez ces lignes **une par
une**, en appuyant sur Entrée à chaque fois :

```
git add .
git commit -m "Consultation des donnees saisies"
git push
```

## A3. Regarder Railway travailler

1. Ouvrez [railway.com](https://railway.com), entrez dans votre projet.
2. Cliquez sur le service **backend**.
3. Onglet **Deployments** : un nouveau déploiement démarre tout seul, en haut.
4. Attendez qu'il affiche **Success** (vert). Comptez 2 à 5 minutes.

Si vous voyez **Failed** (rouge) : cliquez dessus, lisez les **Logs** (le
journal), et envoyez-moi le message d'erreur — c'est lui qui dit tout.

## A4. Vérifier que c'est bien fait

Ouvrez dans votre navigateur :

```
https://ADRESSE-DE-VOTRE-BACKEND/api/v1/docs
```

Cherchez la ligne `GET /numerisations/{passeport_id}`, cliquez dessus. Vous
devez voir `donnees_json` mentionné dans la réponse d'exemple. Si oui, la
Partie A est terminée.

---

# Partie B — Mettre l'application mobile en ligne

## Ce qu'il faut savoir d'abord

L'application mobile est une **PWA** : un site web qui s'installe sur le
téléphone comme une vraie application (icône sur l'écran d'accueil, plein
écran, fonctionne sans réseau). Il n'y a donc **rien à déposer sur l'App Store
ni sur Google Play**, et rien à faire signer.

« Déployer l'application mobile sur Railway » veut donc dire : **mettre ce site
en ligne**. Ensuite, chaque agent l'installe depuis son téléphone en une seule
manipulation (étape B7).

## B1. Copier l'application dans votre projet

Récupérez le dossier de l'application mobile (celui qui contient `src/`,
`public/`, `package.json`, `Dockerfile`) et posez-le **dans votre dossier de
projet**, en le renommant :

```
ppb-platform/
├── backend/     ← le cerveau (déjà en ligne)
├── frontend/    ← le site d'administration (déjà en ligne)
└── mobile/      ← ⬅️ NOUVEAU : l'application des agents
```

Le nom `mobile` est celui que vous taperez à l'étape B4. Si vous choisissez un
autre nom, utilisez le même partout.

⚠️ **N'envoyez pas le dossier `node_modules`** s'il est présent : il est énorme
et inutile. Le fichier `.dockerignore` fourni s'en charge, mais si votre `git`
essaie de l'ajouter, supprimez-le simplement avant d'envoyer.

## B2. Envoyer sur GitHub

```
git add .
git commit -m "Application mobile des agents"
git push
```

## B3. Créer le service sur Railway

1. Sur Railway, entrez dans votre projet — vous voyez le grand tableau avec vos
   cartes existantes (Postgres, backend, frontend).
2. Cliquez **+ New** → **GitHub Repo**.
3. Choisissez **le même dépôt** que d'habitude.
4. Une nouvelle carte apparaît. Cliquez dessus pour l'ouvrir.

## B4. Lui dire quel dossier utiliser ⚠️ étape la plus importante

Sans cette étape, Railway essaie de construire tout le projet en même temps et
échoue.

1. Dans ce nouveau service, onglet **Settings**.
2. Cherchez **Root Directory**.
3. Écrivez exactement : `mobile`
4. Validez.

Railway trouve alors tout seul le `Dockerfile` que j'ai placé dans ce dossier,
et sait quoi faire.

## B5. Lui donner l'adresse de la plateforme centrale

1. Onglet **Variables** de ce service mobile.
2. Ajoutez :

```
VITE_API_BASE_URL=https://ADRESSE-DE-VOTRE-BACKEND
```

(l'adresse notée en Partie A, avec `https://` devant, **sans** slash à la fin,
**sans** `/api/v1` — l'application ajoute cette partie elle-même)

⚠️ Cette adresse est **gravée dans l'application au moment de la
construction**. Si vous l'ajoutez après le premier déploiement, il faut cliquer
**Redeploy** pour qu'elle soit prise en compte. La modifier sans redéployer ne
change rien.

## B6. Lui donner une adresse publique

1. **Settings** → **Networking** → **Generate Domain**.
2. Railway vous donne une adresse, par exemple :
   `ppb-mobile-production.up.railway.app`
3. **Notez-la.** Vous en avez besoin tout de suite après.

## B7. Autoriser l'application à parler au cerveau (CORS)

Par sécurité, la plateforme centrale refuse de répondre à un site qu'elle ne
connaît pas. C'est exactement l'erreur « Serveur injoignable » que vous avez
déjà rencontrée. Il faut donc la présenter.

1. Retournez dans le service **backend** → onglet **Variables**.
2. Trouvez `CORS_ORIGINS` et mettez **les deux adresses**, séparées par une
   virgule, entre crochets :

```
CORS_ORIGINS=["https://ADRESSE-DU-FRONTEND","https://ADRESSE-DU-MOBILE"]
```

Règles à respecter au caractère près, sinon ça ne marche pas :
- `https://` **une seule fois** (pas `https://https://`)
- **pas** de slash `/` à la fin d'une adresse
- guillemets droits `"` et virgule entre les deux adresses

3. Le backend redémarre tout seul. Attendez le **Success** vert.

## B8. Installer l'application sur le téléphone 📱

Donnez l'adresse de l'étape B6 aux agents, puis :

**Sur Android (Chrome)**
1. Ouvrir l'adresse dans Chrome.
2. Une bannière « Installer l'application » apparaît en bas → appuyer dessus.
3. Sinon : bouton **⋮** (trois points en haut à droite) → **Installer
   l'application** ou **Ajouter à l'écran d'accueil**.

**Sur iPhone (Safari — obligatoirement Safari, pas Chrome)**
1. Ouvrir l'adresse dans **Safari**.
2. Appuyer sur le bouton **Partager** (le carré avec une flèche vers le haut).
3. Faire défiler et choisir **Sur l'écran d'accueil**.
4. Appuyer sur **Ajouter**.

Une icône PPB apparaît sur l'écran d'accueil. C'est l'application.

## B9. Le tout premier lancement, avec du réseau

**Cette étape n'est pas facultative.** L'application a besoin d'Internet une
seule fois, au début, pour deux raisons :
- vérifier l'identité de l'agent,
- **télécharger et garder sur le téléphone** son stock de passeports vierges et
  le moteur de lecture (environ 15 Mo).

1. Ouvrir l'application avec du réseau (Wi-Fi de préférence).
2. Se connecter avec le compte agent d'émission.
3. Attendre que le stock de passeports s'affiche sur le tableau de bord.
4. **Laisser l'application ouverte une minute** sans couper le réseau, le temps
   que tout finisse de se télécharger.

Ensuite seulement, elle fonctionne des heures sans aucun réseau. Sauter cette
étape et partir directement sur le terrain donnerait une application vide.

---

# Si quelque chose ne marche pas

| Ce que vous voyez | Ce que ça veut dire | Quoi faire |
|---|---|---|
| Page blanche | La construction a échoué | Service mobile → **Deployments** → ouvrir le dernier → lire les **Logs** |
| « Serveur injoignable » | Le backend refuse l'adresse du mobile | Refaire l'étape **B7** en vérifiant chaque caractère |
| « Email ou mot de passe incorrect » | Bonne nouvelle : le réseau et CORS fonctionnent, le serveur répond | C'est bien le compte qui est en cause |
| Ancienne version affichée | Le téléphone garde une copie en mémoire | Dans l'application : **Réglages** → **Recharger la dernière version** |
| Doute sur l'adresse de l'API | À vérifier sans console | Dans l'application : **Réglages** → **Tester la connexion** |
| Stock de passeports vide | Rôle du compte, pays, ou statut des passeports | Dans l'application : **Analyser le stock**, qui nomme la cause exacte |
| Le déploiement affiche « Failed » | Erreur de construction | Lire les **Logs** et me transmettre le message |

---

# Le strict minimum, en 8 lignes

1. Copier les 2 fichiers modifiés dans `backend/`
2. Copier l'application mobile dans un dossier `mobile/`
3. `git add .` → `git commit -m "maj"` → `git push`
4. Railway → **+ New** → **GitHub Repo** → même dépôt
5. Ce service → **Settings** → **Root Directory** = `mobile`
6. **Variables** → `VITE_API_BASE_URL=https://adresse-du-backend`
7. **Networking** → **Generate Domain** → noter l'adresse
8. Service backend → **Variables** → ajouter cette adresse dans `CORS_ORIGINS`

Puis : ouvrir l'adresse sur le téléphone, installer, se connecter **une fois
avec du réseau**.