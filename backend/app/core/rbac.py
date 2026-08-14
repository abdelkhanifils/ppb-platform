"""
RBAC — 6 rôles (Document technique §6 « Sécurité transversale »).

    Super Admin      -> super_admin
    Admin National   -> admin_national     (= Ministère de l'Élevage, cf. diagramme de cas d'utilisation)
    Agent émission   -> agent_emission     (Agent d'émission + Agent CEBEVIRHA paiement)
    Agent contrôle   -> agent_controle
    Vétérinaire      -> veterinaire
    Consultation     -> consultation       (lecture seule — statistiques, audits)

Chaque endpoint sensible déclare les rôles autorisés via `require_roles(...)`.
Le principe transversal du document technique s'applique : toute route
sensible (attribution, impression, contrôle, configuration) est protégée
et journalisée dans la piste d'audit (voir app.core.audit, à brancher sur
chaque action listée §6).
"""
from enum import Enum


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN_NATIONAL = "admin_national"
    AGENT_EMISSION = "agent_emission"
    AGENT_CONTROLE = "agent_controle"
    VETERINAIRE = "veterinaire"
    CONSULTATION = "consultation"


# Matrice de référence module -> rôles autorisés en écriture.
# Utilisée comme documentation vivante ; l'application effective se fait
# route par route via `require_roles` (voir app/api/v1/deps.py) pour rester
# explicite et auditable dans chaque routeur.
MODULE_WRITE_ROLES: dict[str, set[Role]] = {
    "commandes": {Role.ADMIN_NATIONAL, Role.SUPER_ADMIN},
    "paiements_presentiel": {Role.SUPER_ADMIN, Role.ADMIN_NATIONAL},  # "Agent CEBEVIRHA" -> super_admin en pratique
    "paiements_remboursement": {Role.SUPER_ADMIN},
    "impression_decentralisee": {Role.SUPER_ADMIN},
    "autorisations_impression": {Role.SUPER_ADMIN},
    "numerisations": {Role.AGENT_EMISSION},
    "controles": {Role.AGENT_CONTROLE},
    "vaccinations_validation": {Role.VETERINAIRE, Role.AGENT_EMISSION},
    "admin_formulaires": {Role.SUPER_ADMIN},
    "admin_parametres": {Role.SUPER_ADMIN},
    "admin_gabarit": {Role.SUPER_ADMIN},
}

ALL_ROLES = {r for r in Role}
READ_ONLY_ROLES = {Role.CONSULTATION, Role.SUPER_ADMIN}
