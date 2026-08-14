from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.startup_checks import verifier_secrets_production


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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/", tags=["Santé"])
async def racine():
    return {"service": settings.PROJECT_NAME, "environnement": settings.ENVIRONMENT, "statut": "ok"}


@app.get("/health", tags=["Santé"])
async def health():
    return {"statut": "ok"}
