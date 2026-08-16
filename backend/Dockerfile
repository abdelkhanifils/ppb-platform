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
    ( curl -fsSL -o app/assets/fonts/Amiri-Regular.ttf \
        https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf \
      && curl -fsSL -o app/assets/fonts/Amiri-Bold.ttf \
        https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Bold.ttf \
      || echo "AVERTISSEMENT : téléchargement de la police arabe échoué — le rendu FR/AR sera dégradé." )

COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
