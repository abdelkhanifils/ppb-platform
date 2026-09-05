from pydantic import BaseModel


class EntreeAuditOut(BaseModel):
    id: str
    utilisateur_id: str
    utilisateur_nom: str | None  # None si le compte a depuis été supprimé (ne devrait pas arriver — désactivation seule)
    action: str
    entite: str
    entite_id: str
    ancienne_valeur: dict | None
    nouvelle_valeur: dict | None
    cree_le: str  # ISO 8601
