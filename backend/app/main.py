"""
Point d'entrée de l'API.

Un gestionnaire d'exceptions global est branché ici, et ce n'est pas un
raffinement : sans lui, une erreur serveur devient IMPOSSIBLE à diagnostiquer
depuis un navigateur. Starlette place le traitement des exceptions non gérées
TOUT EN HAUT de la pile, donc AU-DESSUS du middleware CORS : la réponse 500
part alors sans en-tête `Access-Control-Allow-Origin`, et le navigateur
n'affiche pas « erreur 500 » mais « bloqué par la politique CORS ». C'est
exactement le piège rencontré sur le terrain — des heures perdues à corriger
une autorisation d'origine qui fonctionnait parfaitement, alors que le serveur
plantait sur la conversion d'une date. On ajoute donc les en-têtes CORS À LA
MAIN sur la réponse d'erreur, et on renvoie la cause réelle dans `detail`.
"""
import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.startup_checks import verifier_secrets_production

logger = logging.getLogger("ppb")


@asynccontextmanager
async def lifespan(app: FastAPI):
    verifier_secrets_production()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description=(
        "Plateforme numérique du Passeport Pour Bétail (PPB) — CEBEVIRHA / CEMAC. "
        "Modules : Commande, Paiement, Impression, Scan, Contrôle, Administration, Statistiques."
    ),
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url=f"{settings.API_V1_PREFIX}/docs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _origine_autorisee(request: Request) -> str | None:
    """Renvoie l'origine de la requête si elle est autorisée, sinon None.

    Volontairement une reproduction MINIMALE de la logique du middleware CORS :
    on ne veut surtout pas élargir l'autorisation à l'occasion d'une erreur.
    Une origine non autorisée reste refusée — elle verra simplement le message
    CORS habituel, ce qui est le comportement correct.
    """
    origine = request.headers.get("origin")
    if not origine:
        return None
    if "*" in settings.CORS_ORIGINS or origine in settings.CORS_ORIGINS:
        return origine
    if settings.CORS_ORIGIN_REGEX:
        import re

        if re.fullmatch(settings.CORS_ORIGIN_REGEX, origine):
            return origine
    return None


@app.exception_handler(Exception)
async def erreur_interne(request: Request, exc: Exception) -> JSONResponse:
    """Transforme un plantage muet en message exploitable, en-têtes CORS inclus."""
    logger.error(
        "Erreur non gérée sur %s %s : %s\n%s",
        request.method,
        request.url.path,
        exc,
        traceback.format_exc(),
    )

    reponse = JSONResponse(
        status_code=500,
        content={
            "detail": (
                f"Erreur interne de la plateforme sur {request.method} {request.url.path} : "
                f"{type(exc).__name__} — {exc}"
            )
        },
    )

    origine = _origine_autorisee(request)
    if origine:
        reponse.headers["Access-Control-Allow-Origin"] = origine
        reponse.headers["Access-Control-Allow-Credentials"] = "true"
        reponse.headers["Vary"] = "Origin"
    return reponse


app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/", tags=["Santé"])
async def racine():
    return {"service": settings.PROJECT_NAME, "environnement": settings.ENVIRONMENT, "statut": "ok"}


@app.get("/health", tags=["Santé"])
async def health():
    return {"statut": "ok"}