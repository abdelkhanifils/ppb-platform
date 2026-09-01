from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin,
    auth,
    branding,
    commandes,
    controles,
    formulaires_publics,
    notifications,
    numerisations,
    paiements,
    passeports,
    pays,
    statistiques,
    utilisateurs,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(pays.router)
api_router.include_router(commandes.router)
api_router.include_router(paiements.router)
api_router.include_router(passeports.router)
api_router.include_router(numerisations.router)
api_router.include_router(controles.router)
api_router.include_router(admin.router)
api_router.include_router(utilisateurs.router)
api_router.include_router(branding.router)
api_router.include_router(formulaires_publics.router)
api_router.include_router(statistiques.router)
api_router.include_router(notifications.router)
