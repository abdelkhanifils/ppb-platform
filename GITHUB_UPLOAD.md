# Mettre le projet sur GitHub — guide très simple

Vous avez le fichier `ppb-platform.zip` sur votre ordinateur (téléchargé
depuis la conversation). Ce guide vous emmène de ce zip jusqu'à un dépôt
GitHub prêt pour Railway.

---

## Étape 0 — Dézipper le projet

1. Trouvez `ppb-platform.zip` dans vos téléchargements.
2. Double-cliquez dessus (ou clic droit → "Extraire tout").
3. Vous obtenez un dossier `ppb-platform`. Retenez où il se trouve
   (ex. `Bureau/ppb-platform` ou `Téléchargements/ppb-platform`).

---

## Étape 1 — Installer Git (si ce n'est pas déjà fait)

Git est l'outil qui envoie votre code vers GitHub.

1. Ouvrez un terminal :
   - **Windows** : cherchez "PowerShell" dans le menu Démarrer.
   - **Mac** : cherchez "Terminal" (avec la loupe, en haut à droite).
2. Tapez `git --version` puis Entrée.
   - Si un numéro de version s'affiche → Git est déjà là, passez à l'étape 2.
   - Si un message dit que la commande est introuvable → allez sur
     [git-scm.com/downloads](https://git-scm.com/downloads), téléchargez,
     installez (cliquez "Suivant" partout), puis recommencez cette étape.

---

## Étape 2 — Créer le dépôt vide sur GitHub

1. Allez sur [github.com](https://github.com), connectez-vous.
2. En haut à droite, cliquez le **`+`** puis **"New repository"**.
3. **Repository name** : `ppb-platform` (ou le nom que vous voulez).
4. Laissez **"Public"** ou choisissez **"Private"** (privé = seul vous le
   voyez ; Railway peut lire les deux, pas de contrainte ici).
5. **NE COCHEZ RIEN** en bas (pas de README, pas de .gitignore, pas de
   licence) — votre dossier a déjà tout ce qu'il faut, cocher ces cases
   créerait des conflits inutiles.
6. Cliquez **"Create repository"**.
7. GitHub affiche une page avec des commandes. **Gardez cette page ouverte**,
   vous avez besoin de l'adresse affichée, qui ressemble à :
   `https://github.com/VOTRE-NOM/ppb-platform.git`

---

## Étape 3 — Envoyer le projet

Dans votre terminal (celui de l'étape 1) :

1. Déplacez-vous dans le dossier du projet (adaptez le chemin à l'endroit
   où vous l'avez dézippé) :
   ```
   cd Bureau/ppb-platform
   ```
2. Tapez ces commandes **une par une**, en appuyant sur Entrée après chacune :
   ```
   git init
   git add .
   git commit -m "Premier envoi du projet PPB"
   git branch -M main
   git remote add origin https://github.com/VOTRE-NOM/ppb-platform.git
   git push -u origin main
   ```
   (remplacez `https://github.com/VOTRE-NOM/ppb-platform.git` par l'adresse
   copiée à l'étape 2, point 7)

3. Une fenêtre peut s'ouvrir demandant de vous connecter à GitHub — connectez-vous, autorisez.

4. À la fin, le terminal affiche quelque chose comme
   `Writing objects: 100% ...` puis revient à la ligne normale — c'est fini.

---

## Étape 4 — Vérifier

1. Retournez sur la page GitHub de votre dépôt, rafraîchissez (F5).
2. Vous devez voir tous vos dossiers : `backend/`, `frontend/`, `README.md`, etc.
3. **Vérifiez qu'il n'y a PAS** de dossier `backend/secrets/` ni de fichier
   `.env` visible — s'ils apparaissent, dites-le moi immédiatement, ça
   voudrait dire qu'un secret a été envoyé par erreur (peu probable, le
   `.gitignore` du projet les bloque déjà, mais mieux vaut vérifier).

C'est fait — vous pouvez maintenant suivre `RAILWAY_DEPLOY.md` depuis
l'étape "Créer un nouveau projet".

---

## Si vous modifiez le projet plus tard

Après un premier envoi, plus besoin de refaire tout ça. Depuis le dossier du
projet, à chaque changement :
```
git add .
git commit -m "Description courte du changement"
git push
```
Railway redéploie automatiquement à chaque `git push` (si vous avez laissé
les réglages par défaut).

---

## Problèmes fréquents

- **"git: command not found"** → Git n'est pas installé, revenez à l'étape 1.
- **"remote origin already exists"** → vous avez déjà fait `git remote add`
  une fois. Tapez `git remote -v` pour vérifier l'adresse déjà enregistrée ;
  si elle est correcte, sautez directement à `git push -u origin main`.
- **"Support for password authentication was removed"** → GitHub n'accepte
  plus les mots de passe simples pour `git push`. Le plus simple : installez
  [GitHub Desktop](https://desktop.github.com) (interface graphique, pas de
  terminal) et faites l'étape 3 depuis cette application à la place.
- **Le `git push` demande un "Personal Access Token"** → sur GitHub,
  `Settings` (de votre compte, pas du dépôt) → `Developer settings` →
  `Personal access tokens` → `Generate new token` → cochez `repo` → copiez
  le jeton généré et collez-le à la place du mot de passe demandé.
- **"Updates were rejected because the remote contains work that you do
  not have locally"** → le dépôt GitHub contient déjà quelque chose (souvent
  une case cochée par erreur à la création : README, .gitignore, licence).
  Deux solutions :
  - **La plus sûre** : sur GitHub, `Settings` du dépôt → tout en bas,
    `Delete this repository` → confirmez → recréez-le en veillant à
    **ne cocher aucune case**. Puis, dans le terminal, retapez seulement
    `git push -u origin main` (pas besoin de refaire `git init` etc., votre
    dépôt local a déjà tout).
  - **Sans supprimer le dépôt** : tapez
    `git pull origin main --allow-unrelated-histories`, puis Entrée. Si un
    éditeur de texte s'ouvre pour un message de fusion, ne touchez à rien,
    fermez-le en sauvegardant (`Ctrl+X` puis `O` puis Entrée si c'est
    "nano"). Ensuite `git push -u origin main`. Si Git signale un
    "conflit" sur un fichier précis, dites-le moi, ça se résout mais ça
    demande un pas de plus.
