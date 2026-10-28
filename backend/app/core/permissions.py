"""
Catalogue des fonctionnalités et permissions par rôle (matrice configurable).

Principe : chaque route sensible déclare UNE permission (`require_permission(code)`).
Les valeurs par défaut ci-dessous reproduisent exactement les gardes `require_roles`
historiques ; la table `permissions_roles` ne stocke que les ÉCARTS par rapport
à ce défaut (case cochée en plus / décochée). Sans écart, comportement inchangé.

Règles de sécurité :
- Super Admin dispose toujours de tout (ligne verrouillée, non modifiable).
- Les permissions `reservee_super_admin` (sauvegarde, remise à zéro, remboursement)
  ne peuvent être accordées à aucun autre rôle.
- Le profil IT ne reçoit jamais d'accès métier par défaut.
"""
from dataclasses import dataclass

from app.core.rbac import Role

SA = Role.SUPER_ADMIN
AN = Role.ADMIN_NATIONAL
GE = Role.GESTIONNAIRE_CEBEVIRHA
CO = Role.COMPTABILITE
AE = Role.AGENT_EMISSION
AC = Role.AGENT_CONTROLE
CS = Role.CONSULTATION
IT = Role.IT


@dataclass(frozen=True)
class Permission:
    code: str
    module: str
    libelle: str
    defaut: frozenset
    reservee_super_admin: bool = False


def _p(code, module, libelle, roles, reservee=False) -> Permission:
    return Permission(code, module, libelle, frozenset(roles), reservee)


CATALOGUE: list[Permission] = [
    # Commandes
    _p("commandes.gerer", "Commandes", "Créer, consulter et modifier les commandes", [SA, AN, GE]),
    # Paiements
    _p("paiements.enregistrer", "Paiements", "Enregistrer un paiement présentiel", [SA, AN, GE]),
    _p("paiements.valider", "Paiements", "Valider un paiement", [SA, CO]),
    _p("paiements.rembourser", "Paiements", "Rembourser un paiement", [SA], True),
    # Comptabilité
    _p("comptabilite.consulter", "Comptabilité", "États de paiements, exports et factures (lecture / impression)", [SA, CO, GE, CS]),
    # Impression / passeports
    _p("impression.centralisee", "Impression", "Confirmer l'impression centralisée (siège)", [SA, GE]),
    _p("impression.lot", "Impression", "Déclarer un lot imprimé (décentralisé)", [SA, AN]),
    _p("impression.autorisations", "Impression", "Créer / suspendre les autorisations d'impression par pays", [SA]),
    _p("passeports.suivi", "Passeports", "Suivi des émissions, détail et passeports révoqués", [SA, AN]),
    _p("passeports.historique", "Passeports", "Historique d'une personne", [SA]),
    _p("passeports.revoquer", "Passeports", "Révoquer des passeports", [SA]),
    _p("passeports.republier", "Passeports", "Republier les passeports non publiés", [SA]),
    # Terrain
    _p("numerisations.scanner", "Terrain", "Numériser / émettre un passeport (agent d'émission)", [AE]),
    _p("controles.effectuer", "Terrain", "Effectuer un contrôle aux frontières", [AC]),
    _p("controles.signalements", "Terrain", "Consulter les signalements de contrôle", [SA, AN]),
    # Statistiques
    _p("statistiques.consulter", "Statistiques", "Consulter les statistiques et exports", [SA, AN, CS]),
    # Administration
    _p("utilisateurs.gerer", "Administration", "Gérer les comptes utilisateurs", [SA, AN, IT]),
    _p("roles.configurer", "Administration", "Configurer les rôles et leurs accès", [SA, IT]),
    _p("presence.consulter", "Administration", "Voir les utilisateurs en ligne", [SA, IT]),
    _p("admin.formulaires", "Administration", "Configurer les formulaires et paramètres", [SA, IT]),
    _p("admin.gabarit", "Administration", "Valider les textes du gabarit de passeport", [SA, IT]),
    _p("branding.modifier", "Administration", "Personnalisation (logo, couleurs, cachet)", [SA, IT]),
    _p("referentiels.gerer", "Administration", "Gérer localités et postes frontières", [SA, IT]),
    _p("journaux.consulter", "Administration", "Consulter la piste d'audit", [SA, IT]),
    _p("sauvegarde.gerer", "Administration", "Sauvegarde et restauration", [SA], True),
    _p("reinitialisation.executer", "Administration", "Remise à zéro des données", [SA], True),
]

PAR_CODE: dict[str, Permission] = {p.code: p for p in CATALOGUE}

# Rôles dont la ligne est figée dans l'interface.
ROLES_VERROUILLES = {Role.SUPER_ADMIN}


def defaut_pour(role: Role) -> set[str]:
    return {p.code for p in CATALOGUE if role in p.defaut}


def accordable(code: str, role: Role) -> bool:
    """Peut-on accorder `code` à `role` ? (jamais pour les permissions réservées)."""
    p = PAR_CODE[code]
    if role == Role.SUPER_ADMIN:
        return True
    return not p.reservee_super_admin
