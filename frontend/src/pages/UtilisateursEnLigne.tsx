import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, RefreshCw, ShieldCheck, Users, Wifi, Settings } from "lucide-react";
import { apiClient } from "@/api/client";
import CarteStatIconee from "@/components/CarteStatIconee";
import { useAuth } from "@/contexts/AuthContext";
import { LIBELLES_ROLE, Role } from "@/types/roles";
import type { Presence } from "@/types/rolesAcces";

function depuis(iso: string | null): string {
  if (!iso) return "Jamais connecté";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return `il y a ${j} j`;
}

/** Tableau de bord des utilisateurs en ligne (profil IT et Super Admin).
 * « En ligne » = requête authentifiée dans les 5 dernières minutes ; la
 * liste se rafraîchit toute seule toutes les 30 secondes. */
export default function UtilisateursEnLigne({ accueil = false }: { accueil?: boolean }) {
  const { aPermission } = useAuth();
  const [presence, setPresence] = useState<Presence | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [seulementEnLigne, setSeulementEnLigne] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [, setTick] = useState(0);

  const charger = useCallback(async () => {
    try {
      const { data } = await apiClient.get<Presence>("/roles/presence");
      setPresence(data);
      setErreur(null);
    } catch {
      setErreur("Impossible de charger les utilisateurs en ligne.");
    }
  }, []);

  useEffect(() => {
    void charger();
    const id = window.setInterval(() => {
      void charger();
      setTick((t) => t + 1);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [charger]);

  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (presence?.utilisateurs ?? []).filter(
      (u) =>
        (!seulementEnLigne || u.en_ligne) &&
        (!q || u.nom_complet.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.pays ?? "").toLowerCase().includes(q)),
    );
  }, [presence, seulementEnLigne, recherche]);

  const rolesRepresentes = Object.keys(presence?.par_role ?? {}).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
            <Activity size={20} className="text-cebevirha" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-bleuCemac">{accueil ? "Tableau de bord IT" : "Utilisateurs en ligne"}</h1>
            <p className="text-sm text-gray-500">Qui est connecté en ce moment, par profil et par pays.</p>
          </div>
        </div>
        {accueil && (
          <div className="flex gap-2">
            {aPermission("roles.configurer") && (
              <Link to="/roles" className="inline-flex items-center gap-2 rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light">
                <ShieldCheck size={16} /> Rôles et accès
              </Link>
            )}
            <Link to="/administration" className="inline-flex items-center gap-2 rounded-md border border-cebevirha/40 px-4 py-2 text-sm font-medium text-cebevirha hover:bg-white">
              <Settings size={16} /> Administration
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CarteStatIconee icone={Wifi} couleur="vert" libelle="En ligne maintenant" valeur={String(presence?.en_ligne ?? "–")} />
        <CarteStatIconee icone={Users} couleur="bleu" libelle="Comptes actifs" valeur={String(presence?.total_actifs ?? "–")} />
        <CarteStatIconee icone={ShieldCheck} couleur="violet" libelle="Profils représentés en ligne" valeur={String(rolesRepresentes)} />
      </div>

      {presence && rolesRepresentes > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(presence.par_role).map(([r, n]) => (
            <span key={r} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              {LIBELLES_ROLE[r as Role] ?? r} · {n}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3">
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un nom, un email, un pays…"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={seulementEnLigne} onChange={(e) => setSeulementEnLigne(e.target.checked)} className="size-4 accent-cebevirha" />
            En ligne seulement
          </label>
          <button onClick={() => void charger()} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw size={14} /> Actualiser
          </button>
        </div>

        {erreur && <p className="px-4 py-3 text-sm text-red-600">{erreur}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5">Utilisateur</th>
                <th className="px-4 py-2.5">Profil</th>
                <th className="px-4 py-2.5">Pays</th>
                <th className="px-4 py-2.5">Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((u) => (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-2 text-xs font-medium ${u.en_ligne ? "text-emerald-700" : "text-gray-400"}`}>
                      <span className={`size-2.5 rounded-full ${u.en_ligne ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-gray-300"}`} />
                      {u.en_ligne ? "En ligne" : "Hors ligne"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{u.nom_complet}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{LIBELLES_ROLE[u.role] ?? u.role}</td>
                  <td className="px-4 py-2.5 text-gray-700">{u.pays ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{depuis(u.derniere_activite)}</td>
                </tr>
              ))}
              {presence && liste.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">Aucun utilisateur ne correspond.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
          « En ligne » : activité dans les {presence?.seuil_minutes ?? 5} dernières minutes. Actualisation automatique toutes les 30 s.
        </p>
      </div>
    </div>
  );
}
