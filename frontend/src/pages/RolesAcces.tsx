import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { LIBELLES_ROLE, Role } from "@/types/roles";
import type { MatriceRoles } from "@/types/rolesAcces";

/** Libellés courts pour les en-têtes de colonnes (les libellés complets sont en infobulle). */
const COURT: Record<Role, string> = {
  [Role.SUPER_ADMIN]: "Super Admin",
  [Role.ADMIN_NATIONAL]: "Admin National",
  [Role.GESTIONNAIRE_CEBEVIRHA]: "Gestionnaire",
  [Role.COMPTABILITE]: "Comptabilité",
  [Role.AGENT_EMISSION]: "Agent d'émission",
  [Role.AGENT_CONTROLE]: "Agent de contrôle",
  [Role.VETERINAIRE]: "Vétérinaire",
  [Role.CONSULTATION]: "Consultation",
  [Role.IT]: "IT",
};

const ORDRE: Role[] = [
  Role.SUPER_ADMIN,
  Role.IT,
  Role.ADMIN_NATIONAL,
  Role.GESTIONNAIRE_CEBEVIRHA,
  Role.COMPTABILITE,
  Role.AGENT_EMISSION,
  Role.AGENT_CONTROLE,
  Role.VETERINAIRE,
  Role.CONSULTATION,
];

function messageErreur(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : "Une erreur est survenue. Réessayez.";
}

/** Écran « Rôles et accès » : une case à cocher par fonctionnalité et par rôle.
 * Les valeurs par défaut reproduisent les droits historiques ; une case
 * différente du défaut est surlignée. Les règles de sécurité (Super Admin
 * figé, fonctionnalités réservées, profil IT modifiable par un Super Admin
 * seulement) sont aussi appliquées côté serveur. */
export default function RolesAcces({ integre = false }: { integre?: boolean }) {
  const { utilisateur } = useAuth();
  const estSuperAdmin = utilisateur?.role === Role.SUPER_ADMIN;
  const [matrice, setMatrice] = useState<MatriceRoles | null>(null);
  const [brouillon, setBrouillon] = useState<Record<string, Set<string>>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const appliquer = useCallback((m: MatriceRoles) => {
    setMatrice(m);
    setBrouillon(Object.fromEntries(m.roles.map((r) => [r.role, new Set(r.permissions)])));
  }, []);

  const charger = useCallback(async () => {
    try {
      const { data } = await apiClient.get<MatriceRoles>("/roles/matrice");
      appliquer(data);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appliquer]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const modules = useMemo(() => {
    const groupes: { module: string; items: MatriceRoles["catalogue"] }[] = [];
    for (const f of matrice?.catalogue ?? []) {
      let g = groupes.find((x) => x.module === f.module);
      if (!g) groupes.push((g = { module: f.module, items: [] }));
      g.items.push(f);
    }
    return groupes;
  }, [matrice]);

  if (!matrice) {
    return <p className="text-sm text-gray-500">{erreur ?? "Chargement…"}</p>;
  }

  const ligne = (r: Role) => matrice.roles.find((x) => x.role === r)!;
  const modifie = (r: Role) => {
    const actuel = new Set(ligne(r).permissions);
    const b = brouillon[r];
    return !b || b.size !== actuel.size || [...b].some((c) => !actuel.has(c));
  };
  const rolesModifies = ORDRE.filter((r) => !ligne(r).verrouille && modifie(r));
  const verrouilleePourMoi = (r: Role) => ligne(r).verrouille || (r === Role.IT && !estSuperAdmin);

  const basculer = (r: Role, code: string) => {
    setMessage(null);
    setBrouillon((prev) => {
      const s = new Set(prev[r]);
      if (s.has(code)) s.delete(code);
      else s.add(code);
      return { ...prev, [r]: s };
    });
  };

  const enregistrer = async () => {
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    try {
      let derniere: MatriceRoles | null = null;
      for (const r of rolesModifies) {
        const { data } = await apiClient.put<MatriceRoles>(`/roles/matrice/${r}`, { permissions: [...brouillon[r]] });
        derniere = data;
      }
      if (derniere) appliquer(derniere);
      setMessage(`${rolesModifies.length} profil(s) enregistré(s). Les changements s'appliquent dès la prochaine action des utilisateurs concernés.`);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(false);
    }
  };

  const reinitialiser = async (r: Role) => {
    if (!window.confirm(`Rétablir les droits par défaut du profil « ${LIBELLES_ROLE[r]} » ?`)) return;
    setErreur(null);
    setMessage(null);
    try {
      const { data } = await apiClient.post<MatriceRoles>(`/roles/matrice/${r}/reinitialiser`);
      appliquer(data);
      setMessage(`Profil « ${COURT[r]} » rétabli par défaut.`);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  return (
    <div className="space-y-5">
      {!integre && (
      <div className="flex items-center gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
          <ShieldCheck size={20} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-bleuCemac">Rôles et accès</h1>
          <p className="text-sm text-gray-500">
            Cochez les fonctionnalités accessibles à chaque profil. Une case surlignée diffère du réglage par défaut.
          </p>
        </div>
      </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border border-amber-400 bg-amber-100" /> Différent du défaut</span>
        <span className="inline-flex items-center gap-1.5"><Lock size={12} /> Verrouillé (Super Admin, ou réservé au Super Admin)</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="sticky left-0 z-10 w-72 bg-gray-50 px-4 py-3 text-left font-semibold text-bleuCemac">Fonctionnalité</th>
              {ORDRE.map((r) => (
                <th key={r} title={LIBELLES_ROLE[r]} className="px-2 py-3 text-center text-xs font-semibold leading-tight text-bleuCemac">
                  <div>{COURT[r]}</div>
                  {!verrouilleePourMoi(r) && (
                    <button onClick={() => reinitialiser(r)} className="mt-1 inline-flex items-center gap-1 text-[10px] font-normal text-gray-400 hover:text-cebevirha" title="Rétablir les droits par défaut">
                      <RotateCcw size={10} /> défaut
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((g) => (
              <ModuleLignes
                key={g.module}
                module={g.module}
                items={g.items}
                ligne={ligne}
                brouillon={brouillon}
                verrouilleePourMoi={verrouilleePourMoi}
                basculer={basculer}
              />
            ))}
          </tbody>
        </table>
      </div>

      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur">
        <p className="text-sm text-gray-500">
          {rolesModifies.length === 0 ? "Aucune modification en attente." : `${rolesModifies.length} profil(s) modifié(s) : ${rolesModifies.map((r) => COURT[r]).join(", ")}.`}
        </p>
        <div className="flex gap-2">
          <button
            disabled={rolesModifies.length === 0 || enCours}
            onClick={() => appliquer(matrice)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            disabled={rolesModifies.length === 0 || enCours}
            onClick={enregistrer}
            className="inline-flex items-center gap-2 rounded-md bg-cebevirha px-5 py-2 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-40"
          >
            <Check size={16} /> {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModuleLignes({
  module,
  items,
  ligne,
  brouillon,
  verrouilleePourMoi,
  basculer,
}: {
  module: string;
  items: MatriceRoles["catalogue"];
  ligne: (r: Role) => MatriceRoles["roles"][number];
  brouillon: Record<string, Set<string>>;
  verrouilleePourMoi: (r: Role) => boolean;
  basculer: (r: Role, code: string) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={ORDRE.length + 1} className="sticky left-0 border-y border-gray-200 bg-cebevirha/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-cebevirha">
          {module}
        </td>
      </tr>
      {items.map((f) => (
        <tr key={f.code} className="border-b border-gray-100 hover:bg-gray-50/60">
          <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-800">
            {f.libelle}
            {f.reservee_super_admin && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Super Admin seul</span>}
          </td>
          {ORDRE.map((r) => {
            const l = ligne(r);
            const coche = brouillon[r]?.has(f.code) ?? false;
            const defautCoche = l.defaut.includes(f.code);
            const interdit = f.reservee_super_admin && r !== Role.SUPER_ADMIN;
            const fige = verrouilleePourMoi(r) || interdit;
            const diff = !l.verrouille && coche !== defautCoche;
            return (
              <td key={r} className="px-2 py-2 text-center">
                <label className={`inline-flex size-7 items-center justify-center rounded ${diff ? "border border-amber-400 bg-amber-100" : ""}`}>
                  {fige ? (
                    coche ? <Lock size={13} className="text-gray-400" aria-label="accordé, verrouillé" /> : <span className="text-gray-300" aria-label="non accordé, verrouillé">–</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={coche}
                      onChange={() => basculer(r, f.code)}
                      className="size-4 accent-cebevirha"
                      aria-label={`${COURT[r]} — ${f.libelle}`}
                    />
                  )}
                </label>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
