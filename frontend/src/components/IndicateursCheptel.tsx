import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { apiClient } from "@/api/client";

interface Lieu { pays: string; localite?: string; nb_passeports: number; effectif: number }
interface Indicateurs {
  base: string;
  total_cheptel: number;
  par_espece: { espece: string; males: number; femelles_jeunes: number; femelles_adultes: number; total: number }[];
  par_origine_pays: Lieu[];
  par_origine_localite: Lieu[];
  par_destination_pays: Lieu[];
  par_destination_localite: Lieu[];
  vaccinations: { maladie: string; espece: string; effectif: number }[];
  non_disponibles: { code: string; libelle: string; motif: string }[];
}

const fmt = (n: number) => n.toLocaleString("fr-FR");

function Barre({ valeur, max }: { valeur: number; max: number }) {
  return (
    <div className="h-2 w-full min-w-[60px] rounded bg-gray-100">
      <div className="h-2 rounded bg-cebevirha" style={{ width: `${max ? Math.max(2, (valeur / max) * 100) : 0}%` }} />
    </div>
  );
}

function TableauLieux({ titre, pays, localites }: { titre: string; pays: Lieu[]; localites: Lieu[] }) {
  const [detail, setDetail] = useState(false);
  const lignes = detail ? localites : pays;
  const max = Math.max(0, ...lignes.map((l) => l.effectif));
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-bleuCemac">{titre}</h3>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} className="accent-cebevirha" /> Par localité
        </label>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-1">{detail ? "Pays / localité" : "Pays"}</th>
              <th className="py-1 text-right">Passeports</th>
              <th className="py-1 text-right">Effectif</th>
              <th className="w-24 py-1" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1.5">{detail ? `${l.pays} — ${l.localite}` : l.pays}</td>
                <td className="py-1.5 text-right text-gray-600">{fmt(l.nb_passeports)}</td>
                <td className="py-1.5 text-right font-medium">{fmt(l.effectif)}</td>
                <td className="py-1.5 pl-3"><Barre valeur={l.effectif} max={max} /></td>
              </tr>
            ))}
            {lignes.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-400">Aucune donnée</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Effectifs du cheptel vérifié (à l'émission) ou contrôlé (frontière) :
 * espèce, origine, destination, vaccinations. Les indicateurs dont les
 * données ne sont pas encore collectées sont listés avec leur motif, plutôt
 * que d'afficher des zéros trompeurs. */
export default function IndicateursCheptel({ paysImpose, paysDisponibles }: { paysImpose: number | null; paysDisponibles: { pays_id: number; nom: string }[] }) {
  const [base, setBase] = useState<"emis" | "controles">("emis");
  const [paysId, setPaysId] = useState<number | "tous">(paysImpose ?? "tous");
  const [donnees, setDonnees] = useState<Indicateurs | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    setDonnees(null);
    setErreur(false);
    const params: Record<string, string | number> = { base };
    if (paysId !== "tous") params.pays_id = paysId;
    apiClient.get<Indicateurs>("/statistiques/indicateurs", { params }).then(({ data }) => setDonnees(data)).catch(() => setErreur(true));
  }, [base, paysId]);

  const matrice = useMemo(() => {
    const especes = [...new Set((donnees?.vaccinations ?? []).map((v) => v.espece))].sort();
    const maladies = [...new Set((donnees?.vaccinations ?? []).map((v) => v.maladie))].sort();
    const val = (m: string, e: string) => donnees?.vaccinations.find((v) => v.maladie === m && v.espece === e)?.effectif ?? 0;
    return { especes, maladies, val };
  }, [donnees]);

  const maxEsp = Math.max(0, ...(donnees?.par_espece.map((e) => e.total) ?? [0]));

  return (
    <section className="space-y-4 rounded-lg border border-or/40 bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Effectifs du cheptel</h2>
          <p className="text-xs text-gray-500">Par espèce, origine, destination et vaccination.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2 text-gray-600">
            Base
            <select value={base} onChange={(e) => setBase(e.target.value as "emis" | "controles")} className="rounded-md border border-gray-300 px-2 py-1.5">
              <option value="emis">Vérifié à l'émission</option>
              <option value="controles">Contrôlé aux frontières</option>
            </select>
          </label>
          {paysImpose === null && (
            <label className="flex items-center gap-2 text-gray-600">
              Pays émetteur
              <select value={paysId} onChange={(e) => setPaysId(e.target.value === "tous" ? "tous" : Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5">
                <option value="tous">Tous</option>
                {paysDisponibles.map((p) => <option key={p.pays_id} value={p.pays_id}>{p.nom}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {erreur && <p className="text-sm text-red-600">Impossible de charger les indicateurs.</p>}
      {!donnees && !erreur && <p className="text-sm text-gray-500">Chargement…</p>}

      {donnees && (
        <>
          <div className="rounded-lg bg-cebevirha/5 px-4 py-3">
            <p className="text-xs text-gray-500">{base === "emis" ? "Animaux vérifiés à l'émission" : "Animaux contrôlés aux frontières"}</p>
            <p className="text-2xl font-semibold text-cebevirha">{fmt(donnees.total_cheptel)}</p>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <h3 className="mb-2 text-sm font-semibold text-bleuCemac">Effectifs par espèce</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500">
                    <th className="py-1">Espèce</th><th className="py-1 text-right">Mâles</th><th className="py-1 text-right">Femelles jeunes</th><th className="py-1 text-right">Femelles adultes</th><th className="py-1 text-right">Total</th><th className="w-32 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {donnees.par_espece.map((e) => (
                    <tr key={e.espece} className="border-t border-gray-100">
                      <td className="py-1.5 capitalize">{e.espece}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmt(e.males)}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmt(e.femelles_jeunes)}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmt(e.femelles_adultes)}</td>
                      <td className="py-1.5 text-right font-medium">{fmt(e.total)}</td>
                      <td className="py-1.5 pl-3"><Barre valeur={e.total} max={maxEsp} /></td>
                    </tr>
                  ))}
                  {donnees.par_espece.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-400">Aucune donnée</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TableauLieux titre="Effectifs par origine" pays={donnees.par_origine_pays} localites={donnees.par_origine_localite} />
            <TableauLieux titre="Effectifs par destination" pays={donnees.par_destination_pays} localites={donnees.par_destination_localite} />
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <h3 className="text-sm font-semibold text-bleuCemac">Animaux vaccinés par maladie et par espèce</h3>
            <p className="mb-2 text-xs text-gray-500">La vaccination est enregistrée par troupeau : l'effectif d'une espèce est celui des troupeaux vaccinés.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500">
                    <th className="py-1">Maladie</th>
                    {matrice.especes.map((e) => <th key={e} className="py-1 text-right capitalize">{e}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrice.maladies.map((m) => (
                    <tr key={m} className="border-t border-gray-100">
                      <td className="py-1.5">{m}</td>
                      {matrice.especes.map((e) => <td key={e} className="py-1.5 text-right">{fmt(matrice.val(m, e))}</td>)}
                    </tr>
                  ))}
                  {matrice.maladies.length === 0 && <tr><td className="py-4 text-center text-gray-400">Aucune vaccination enregistrée</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertCircle size={16} /> Indicateurs en attente de collecte de données</p>
            <ul className="space-y-1 text-sm text-amber-900">
              {donnees.non_disponibles.map((n) => (
                <li key={n.code}><span className="font-medium">{n.libelle}</span> — <span className="text-amber-800/80">{n.motif}</span></li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
