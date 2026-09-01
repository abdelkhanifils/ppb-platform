from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    titre: str
    message: str
    lien: str | None
    lu: bool
    cree_le: datetime


class CompteurNonLuesOut(BaseModel):
    non_lues: int
