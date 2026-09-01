import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { apiClient } from "@/api/client";
import { useI18n } from "@/lib/i18n";
import type { Notification } from "@/types/notification";

// Sondage plutôt que WebSocket : le volume de notifications attendu (une
// nouvelle commande de temps en temps, un petit nombre de Super Admins) ne
// justifie pas l'infrastructure d'une connexion temps réel — un délai de
// jusqu'à 30s avant de voir apparaître le badge est un compromis raisonnable
// pour une action qui n'est de toute façon jamais urgente à la seconde près.
const INTERVALLE_SONDAGE_MS = 30_000;

export default function ClocheNotifications() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [ouvert, setOuvert] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [compteur, setCompteur] = useState(0);
  const conteneurRef = useRef<HTMLDivElement>(null);

  const chargerCompteur = () => {
    apiClient
      .get<{ non_lues: number }>("/notifications/compteur")
      .then(({ data }) => setCompteur(data.non_lues))
      .catch(() => {
        /* silencieux — une cloche qui ne se met pas à jour n'est jamais bloquant */
      });
  };

  const chargerListe = () => {
    apiClient
      .get<Notification[]>("/notifications")
      .then(({ data }) => setNotifications(data))
      .catch(() => {
        /* idem */
      });
  };

  useEffect(() => {
    chargerCompteur();
    const intervalle = setInterval(chargerCompteur, INTERVALLE_SONDAGE_MS);
    return () => clearInterval(intervalle);
  }, []);

  useEffect(() => {
    if (ouvert) chargerListe();
  }, [ouvert]);

  // Ferme la liste déroulante au clic en dehors — évite qu'elle reste
  // ouverte quand l'utilisateur clique ailleurs sur la page.
  useEffect(() => {
    const gerer = (e: MouseEvent) => {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", gerer);
    return () => document.removeEventListener("mousedown", gerer);
  }, []);

  const cliquerNotification = async (n: Notification) => {
    if (!n.lu) {
      try {
        await apiClient.post(`/notifications/${n.id}/lire`);
        setCompteur((c) => Math.max(0, c - 1));
        setNotifications((liste) => liste.map((x) => (x.id === n.id ? { ...x, lu: true } : x)));
      } catch {
        /* la navigation se fait quand même même si le marquage échoue */
      }
    }
    setOuvert(false);
    if (n.lien) navigate(n.lien);
  };

  const toutMarquerLu = async () => {
    try {
      await apiClient.post("/notifications/tout-lire");
      setCompteur(0);
      setNotifications((liste) => liste.map((x) => ({ ...x, lu: true })));
    } catch {
      /* silencieux */
    }
  };

  return (
    <div ref={conteneurRef} className="relative">
      <button
        onClick={() => setOuvert((v) => !v)}
        className="relative rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
        aria-label={t("notifications.titre")}
      >
        <Bell size={18} />
        {compteur > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-semibold text-white">
            {compteur > 9 ? "9+" : compteur}
          </span>
        )}
      </button>

      {ouvert && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-or/40 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-sm font-semibold text-gray-800">{t("notifications.titre")}</p>
            {compteur > 0 && (
              <button onClick={toutMarquerLu} className="text-xs font-medium text-cebevirha hover:underline">
                {t("notifications.tout_marquer_lu")}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">{t("notifications.aucune")}</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => cliquerNotification(n)}
                  className={`block w-full border-b border-gray-50 px-3 py-2.5 text-left text-sm hover:bg-gray-50 ${
                    n.lu ? "bg-white" : "bg-amber-50/60"
                  }`}
                >
                  <p className="font-medium text-gray-900">{n.titre}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{n.message}</p>
                  <p className="mt-1 text-[11px] text-gray-400">{new Date(n.cree_le).toLocaleString("fr-FR")}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
