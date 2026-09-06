"""
RBAC — 8 rôles (Document technique §6 « Sécurité transversale »).

    Super Admin        -> super_admin
    Admin National     -> admin_national     (= Ministère de l'Élevage, cf. diagramme de cas d'utilisation)
    Gestionnaire CEBEVIRHA -> gestionnaire_cebevirha (crée des commandes pour n'importe quel
                                             pays, enregistre leur paiement présentiel et gère
                                             l'impression centralisée au siège — jamais la
                                             VALIDATION du paiement qu'il enregistre lui-même
                                             (séparation des tâches, voir Comptabilité), ni
                                             l'impression décentralisée, réservées toutes deux
                                             à Comptabilité/Super Admin)
    Agent émission     -> agent_emission     (Agent d'émission + Agent CEBEVIRHA paiement)
    Agent contrôle     -> agent_controle
    Vétérinaire        -> veterinaire
    Consultation       -> consultation       (lecture seule — statistiques, audits)
    Comptabilité       -> comptabilite       (lecture des commandes/paiements + validation des paiements,
                                             rien d'autre — voir MODULE_WRITE_ROLES ci-dessous)

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
    COMPTABILITE = "comptabilite"
    GESTIONNAIRE_CEBEVIRHA = "gestionnaire_cebevirha"


# Matrice de référence module -> rôles autorisés en écriture.
# Utilisée comme documentation vivante ; l'application effective se fait
# route par route via `require_roles` (voir app/api/v1/deps.py) pour rester
# explicite et auditable dans chaque routeur.
MODULE_WRITE_ROLES: dict[str, set[Role]] = {
    "commandes": {Role.ADMIN_NATIONAL, Role.SUPER_ADMIN, Role.GESTIONNAIRE_CEBEVIRHA},
    "paiements_presentiel": {Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.GESTIONNAIRE_CEBEVIRHA},  # "Agent CEBEVIRHA" -> super_admin en pratique
    # Comptabilité s'ajoute ici volontairement SEULEMENT pour la validation —
    # jamais pour l'enregistrement d'un paiement présentiel ci-dessus, ni pour
    # la création de commande ci-dessus : séparation des tâches délibérée
    # (qui enregistre un paiement ne doit pas être la même personne qui le
    # valide), et Comptabilité n'a par ailleurs accès à AUCUN autre module de
    # la plateforme (voir require_roles sur chaque route de ces deux modules).
    "paiements_validation": {Role.SUPER_ADMIN, Role.COMPTABILITE},
    "paiements_remboursement": {Role.SUPER_ADMIN},
    # Impression CENTRALISÉE (au siège) — Gestionnaire CEBEVIRHA y a accès ;
    # impression DÉCENTRALISÉE (autorisations par pays, ci-dessous) reste
    # volontairement Super Admin seul, y compris pour Gestionnaire.
    "impression_centralisee": {Role.SUPER_ADMIN, Role.GESTIONNAIRE_CEBEVIRHA},
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
