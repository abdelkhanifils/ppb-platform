// Miroir de backend/app/schemas/notification.py
export interface Notification {
  id: string;
  titre: string;
  message: string;
  lien: string | null;
  lu: boolean;
  cree_le: string;
}
