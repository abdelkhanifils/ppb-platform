import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/api/client";
import { paramsPeriode, usePeriode } from "@/lib/periode";
import { BoutonsExport } from "@/components/BoutonsExport";
import { DrapeauPays } from "@/components/DrapeauPays";
import type { CheptelPaysAnnee as Ligne } from "@/types/statistiques";
import { NOMS_MOIS } from "@/types/statistiques";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const maj = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Effectifs du cheptel présentés comme les commandes : une ligne par pays, année et mois, avec
 * recherche par pays / année / mois, base (vérifié à l'émission ou contrôlé aux frontières) et
 * export Excel / PDF de ce qui est affiché. */
export default function CheptelPaysAnnee({ paysImpose, paysDisponibles }: { paysImpose: number | null; paysDisponibles: { pays_id: number; code_iso?: string; nom: string }[] }) {
  const periodeGlobale = usePeriode();
  const [base, setBase] = useState<"emis" | "controles">("emis");
  const [paysId, setPaysId] = useState<number | "tous">(paysImpose ?? "tous");
  const [annee, setAnnee] = useState<number | "toutes">("toutes");
  const [mois, setMois] = useState<number | "tous">("tous");
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [anneesConnues, setAnneesConnues] = useState<number[]>([]);

  useEffect(() => {
    setLignes(null);
    setErreur(false);
    const params: Record<string, string | number> = { base };
    if (paysId !== "tous") params.pays_id = paysId;
    if (annee !== "toutes") params.annee = annee;
    if (mois !== "tous") params.mois = mois;
    Object.assign(params, paramsPeriode(periodeGlobale));
    apiClient
      .get<Ligne[]>("/statistiques/cheptel-pays-annee", { params })
      .then(({ data }) => {
        setLignes(data);
        setAnneesConnues((prec) => Array.from(new Set([...prec, ...data.map((l) => l.annee)])).sort((a, b) => b - a));
      })
      .catch(() => setErreur(true));
  }, [base, paysId, annee, mois, periodeGlobale.debut, periodeGlobale.fin]);

  const especes = useMemo(() => Array.from(new Set((lignes ?? []).flatMap((l) => Object.keys(l.par_espece)))).sort(), [lignes]);
  const nomPays = (id: number) => paysDisponibles.find((p) => p.pays_id === id)?.nom ?? `#${id}`;
  const totaux = useMemo(
    () => ({
      passeports: (lignes ?? []).reduce((s, l) => s + l.nb_passeports, 0),
      total: (lignes ?? []).reduce((s, l) => s + l.total, 0),
      vaccines: (lignes ?? []).reduce((s, l) => s + l.vaccines, 0),
    }),
    [lignes]
  );

  const colonnes = [
    { cle: "pays", titre: "Pays" },
    { cle: "annee", titre: "Année" },
    { cle: "mois", titre: "Mois" },
    { cle: "passeports", titre: "Passeports" },
    { cle: "total", titre: "Animaux (total)" },
    ...especes.map((e) => ({ cle: `e_${e}`, titre: maj(e) })),
    { cle: "vaccines", titre: "Dont vaccinés" },
  ];
  const lignesExport = (lignes ?? []).map((l) => ({
    pays: nomPays(l.pays_id),
    annee: l.annee,
    mois: NOMS_MOIS[l.mois],
    passeports: l.nb_passeports,
    total: l.total,
    ...Object.fromEntries(especes.map((e) => [`e_${e}`, l.par_espece[e] ?? 0])),
    vaccines: l.vaccines,
  }));

  return (
    <section className="rounded-lg border border-or/40 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Cheptel par pays, année et mois</h2>
          <p className="text-xs text-gray-500">Effectifs d'animaux par espèce, avec recherche par pays, année et mois, et export Excel ou PDF.</p>
        </div>
        <BoutonsExport nomBase={`cheptel-${base}`} titre="Cheptel par pays, année et mois" colonnes={colonnes} lignes={lignesExport} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md bg-gray-50 p-3 text-sm">
        <label className="text-xs font-medium text-gray-600">
          <span className="mb-1 block">Base</span>
          <select value={base} onChange={(e) => setBase(e.target.value as "emis" | "controles")} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
            <option value="emis">Vérifié à l'émission</option>
            <option value="controles">Contrôlé aux frontières</option>
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          <span className="mb-1 block">Pays émetteur</span>
          <select
            value={paysId}
            disabled={paysImpose !== null}
            onChange={(e) => setPaysId(e.target.value === "tous" ? "tous" : Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal disabled:bg-gray-100"
          >
            {paysImpose === null && <option value="tous">Tous les pays</option>}
            {paysDisponibles.map((p) => (
              <option key={p.pays_id} value={p.pays_id}>{p.nom}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          <span className="mb-1 block">Année</span>
          <select value={annee} onChange={(e) => setAnnee(e.target.value === "toutes" ? "toutes" : Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
            <option value="toutes">Toutes les années</option>
            {anneesConnues.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          <span className="mb-1 block">Mois</span>
          <select value={mois} onChange={(e) => setMois(e.target.value === "tous" ? "tous" : Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
            <option value="tous">Tous les mois</option>
            {NOMS_MOIS.slice(1).map((nom, k) => (
              <option key={nom} value={k + 1}>{nom}</option>
            ))}
          </select>
        </label>
      </div>

      {erreur && <p className="text-sm text-red-600">Impossible de charger le cheptel.</p>}
      {!lignes && !erreur && <p className="text-sm text-gray-500">Chargement…</p>}
      {lignes && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-or/40 text-xs text-gray-500">
                <th className="py-2 pr-4">Pays</th>
                <th className="py-2 pr-4">Année</th>
                <th className="py-2 pr-4">Mois</th>
                <th className="py-2 pr-4">Passeports</th>
                <th className="py-2 pr-4">Animaux</th>
                {especes.map((e) => (
                  <th key={e} className="py-2 pr-4">{maj(e)}</th>
                ))}
                <th className="py-2 pr-4">Dont vaccinés</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={`${l.pays_id}-${l.annee}-${l.mois}`} className="border-b border-gray-100">
                  <td className="py-2 pr-4">
                    <span className="inline-flex items-center gap-1.5">
                      <DrapeauPays codeIso={paysDisponibles.find((p) => p.pays_id === l.pays_id)?.code_iso} />
                      {nomPays(l.pays_id)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{l.annee}</td>
                  <td className="py-2 pr-4">{NOMS_MOIS[l.mois]}</td>
                  <td className="py-2 pr-4">{fmt(l.nb_passeports)}</td>
                  <td className="py-2 pr-4 font-medium">{fmt(l.total)}</td>
                  {especes.map((e) => (
                    <td key={e} className="py-2 pr-4 text-gray-600">{fmt(l.par_espece[e] ?? 0)}</td>
                  ))}
                  <td className="py-2 pr-4 text-gray-600">{fmt(l.vaccines)}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr>
                  <td colSpan={6 + especes.length} className="py-4 text-center text-gray-400">Aucune donnée pour cette recherche.</td>
                </tr>
              )}
            </tbody>
            {lignes.length > 0 && (
              <tfoot>
                <tr className="border-t border-or/40 text-sm font-semibold">
                  <td className="py-2 pr-4" colSpan={3}>Total</td>
                  <td className="py-2 pr-4">{fmt(totaux.passeports)}</td>
                  <td className="py-2 pr-4">{fmt(totaux.total)}</td>
                  {especes.map((e) => (
                    <td key={e} className="py-2 pr-4">{fmt(lignes.reduce((s, l) => s + (l.par_espece[e] ?? 0), 0))}</td>
                  ))}
                  <td className="py-2 pr-4">{fmt(totaux.vaccines)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
