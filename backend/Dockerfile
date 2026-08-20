FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Police Amiri (arabe, licence libre OFL) — nécessaire pour le rendu du PPB en
# version FR/AR (Module 3). Téléchargée ici, au moment de la construction de
# l'image (Railway a accès à internet à cette étape), car aucune police
# arabe n'est fournie par défaut avec Helvetica/reportlab. Si cette étape
# échoue (miroir indisponible), le build ne casse pas : voir le repli sans
# police dans app/services/pdf_passeport.py (le texte arabe s'affiche alors
# en Helvetica, avec un rendu incorrect — glyphes manquants — jusqu'à ce que
# cette étape puisse retélécharger la police).
RUN mkdir -p app/assets/fonts && \
    ( curl -fsSL --connect-timeout 10 --max-time 30 -o app/assets/fonts/Amiri-Regular.ttf \
        https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf \
      && curl -fsSL --connect-timeout 10 --max-time 30 -o app/assets/fonts/Amiri-Bold.ttf \
        https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Bold.ttf \
      || echo "AVERTISSEMENT : téléchargement de la police arabe échoué — le rendu FR/AR sera dégradé." )

COPY . .

EXPOSE 8000
# La migration s'exécute à chaque démarrage du conteneur, à l'intérieur du
# réseau privé Railway (où les adresses internes type postgres.railway.internal
# résolvent normalement — contrairement à un poste de développeur local, voir
# RAILWAY_DEPLOY.md). But : ne plus jamais dépendre d'une étape manuelle
# `railway run alembic upgrade head` oubliée après un déploiement. Échec
# volontairement bloquant (le `&&` empêche uvicorn de démarrer si la migration
# échoue) : mieux vaut un déploiement qui ne démarre pas du tout qu'un backend
# qui tourne contre un schéma de base de données obsolète.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
