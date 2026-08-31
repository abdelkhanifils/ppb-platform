import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import "leaflet/dist/leaflet.css";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/lib/i18n";
import { DrapeauPays } from "@/components/DrapeauPays";
import { Role } from "@/types/roles";
import type { ClusterMouvements, DetailEmission, StatistiquesParPaysAnnee, StatistiquesParPoste, TableauBordRegional } from "@/types/statistiques";
import { LIBELLES_MOYEN_PAIEMENT_COURT, LIBELLES_PHASE } from "@/types/statistiques";

/**
 * Tableau de bord régional (Module transversal Statistiques) — trois axes :
 * par pays, par phase (entonnoir du pipeline M3->M5) et par poste, plus une
 * carte des mouvements de contrôle (clusters PostGIS en production — voir
 * backend/app/services/geospatial.py, repli portable en développement).
 */
export default function Statistiques() {
  const { utilisateur } = useAuth();
  const { t } = useI18n();
  const paysImpose = utilisateur?.role === Role.ADMIN_NATIONAL ? utilisateur.pays_id : null;
  const [tableauBord, setTableauBord] = useState<TableauBordRegional | null>(null);
  const [postes, setPostes] = useState<StatistiquesParPoste[]>([]);
  const [clusters, setClusters] = useState<ClusterMouvements[]>([]);
  const [parPaysAnnee, setParPaysAnnee] = useState<StatistiquesParPaysAnnee[] | null>(null);
  const [erreurParPaysAnnee, setErreurParPaysAnnee] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    // Chaque section a sa propre gestion d'erreur : un souci sur l'une
    // (ex. la vue croisée pays/année, plus récente) ne doit jamais empêcher
    // l'affichage des autres, déjà éprouvées.
    Promise.all([
      apiClient.get<TableauBordRegional>("/statistiques/tableau-bord"),
      apiClient.get<StatistiquesParPoste[]>("/statistiques/par-poste"),
      apiClient.get<{ clusters: ClusterMouvements[] }>("/statistiques/carte-mouvements"),
    ])
      .then(([bord, postesReponse, clustersReponse]) => {
        setTableauBord(bord.data);
        setPostes(postesReponse.data);
        setClusters(clustersReponse.data.clusters);
      })
      .catch(() => setErreur(t("statistiques.erreur_chargement")))
      .finally(() => setChargement(false));

    apiClient
      .get<StatistiquesParPaysAnnee[]>("/statistiques/par-pays-annee")
      .then(({ data }) => setParPaysAnnee(data))
      .catch(() => setErreurParPaysAnnee(true));
  }, []);

  if (chargement) return <p className="text-sm text-gray-500">{t("statistiques.chargement_tdb")}</p>;
  if (erreur || !tableauBord) return <p className="text-sm text-red-600">{erreur ?? t("statistiques.donnees_indisponibles")}</p>;

  const donneesEntonnoir = tableauBord.entonnoir_global.map((p) => ({
    phase: LIBELLES_PHASE[p.statut] ?? p.statut,
    nombre: p.nombre,
  }));

  const donneesParPays = tableauBord.par_pays.map((p) => ({
    pays: p.code_iso,
    commandes: p.nb_commandes,
    emis: p.passeports_par_statut.emis ?? 0,
    controle: p.passeports_par_statut.controle ?? 0,
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-cebevirha/10">
          <TrendingUp size={20} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-bleuCemac">{t("statistiques.titre")}</h1>
          <p className="text-sm text-gray-500">
            {t("statistiques.resume", {
              pays: tableauBord.totaux.nb_pays,
              commandes: tableauBord.totaux.nb_commandes_total,
              montant: tableauBord.totaux.montant_encaisse_total_xaf.toLocaleString("fr-FR"),
            })}
          </p>
        </div>
      </div>

      <section className="rounded-lg border border-or/40 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">{t("statistiques.entonnoir_titre")}</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={donneesEntonnoir}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="phase" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="nombre" fill="#0f5132" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="rounded-lg border border-or/40 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">{t("statistiques.par_pays_titre")}</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={donneesParPays}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="pays" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="commandes" name={t("nav.commandes")} fill="#146c43" radius={[4, 4, 0, 0]} />
            <Bar dataKey="emis" name={t("statistiques.emis")} fill="#5c9e78" radius={[4, 4, 0, 0]} />
            <Bar dataKey="controle" name={t("statistiques.controles")} fill="#9dc6ac" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="rounded-lg border border-or/40 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">{t("statistiques.par_poste_titre")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-or/40 text-xs text-gray-500">
                <th className="py-2 pr-4">{t("statistiques.poste")}</th>
                <th className="py-2 pr-4">{t("statistiques.total")}</th>
                <th className="py-2 pr-4 text-green-700">{t("statistiques.valides")}</th>
                <th className="py-2 pr-4 text-red-700">{t("statistiques.refuses")}</th>
                <th className="py-2 pr-4 text-amber-700">{t("statistiques.a_verifier")}</th>
              </tr>
            </thead>
            <tbody>
              {postes.map((poste) => (
                <tr key={poste.poste_id} className="border-b border-gray-100">
                  <td className="py-2 pr-4">{poste.nom}</td>
                  <td className="py-2 pr-4 font-medium">{poste.total_controles}</td>
                  <td className="py-2 pr-4">{poste.controles_par_resultat.valide ?? 0}</td>
                  <td className="py-2 pr-4">{poste.controles_par_resultat.refuse ?? 0}</td>
                  <td className="py-2 pr-4">{poste.controles_par_resultat.a_verifier ?? 0}</td>
                </tr>
              ))}
              {postes.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-400">
                    {t("statistiques.aucun_poste")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-or/40 bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">{t("statistiques.detail_titre")}</h2>
            <p className="text-xs text-gray-500">{t("statistiques.detail_intro")}</p>
          </div>
        </div>

        {erreurParPaysAnnee ? (
          <p className="text-sm text-red-600">{t("statistiques.section_echouee")}</p>
        ) : parPaysAnnee === null ? (
          <p className="text-sm text-gray-500">{t("commun.chargement")}</p>
        ) : (
          <FiltreEtTableauPaysAnnee donnees={parPaysAnnee} tableauBord={tableauBord} paysImpose={paysImpose} />
        )}
      </section>

      {(utilisateur?.role === Role.SUPER_ADMIN || utilisateur?.role === Role.ADMIN_NATIONAL) && (
        <SectionEmissionsDetail paysImpose={paysImpose} paysDisponibles={tableauBord.par_pays} />
      )}

      <section className="rounded-lg border border-or/40 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">{t("statistiques.carte_titre")}</h2>
        <p className="mb-3 text-xs text-gray-500">{t("statistiques.carte_intro")}</p>
        {clusters.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            {t("statistiques.aucun_controle_geo")}
          </p>
        ) : (
          <div className="h-96 overflow-hidden rounded-lg">
            <MapContainer center={[7.5, 15]} zoom={5} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {clusters.map((cluster) => (
                <CircleMarker
                  key={cluster.cluster_id}
                  center={[cluster.latitude_centre, cluster.longitude_centre]}
                  radius={Math.min(8 + cluster.nombre * 2, 30)}
                  pathOptions={{ color: couleurCluster(cluster), fillColor: couleurCluster(cluster), fillOpacity: 0.5 }}
                >
                  <Popup>
                    <p className="font-medium">{t("statistiques.n_controles", { n: cluster.nombre })}</p>
                    <p>{t("statistiques.valides")} : {cluster.valides}</p>
                    <p>{t("statistiques.refuses")} : {cluster.refuses}</p>
                    <p>{t("statistiques.a_verifier")} : {cluster.a_verifier}</p>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        )}
      </section>
    </div>
  );
}

function couleurCluster(cluster: ClusterMouvements): string {
  const proportionValide = cluster.nombre > 0 ? cluster.valides / cluster.nombre : 0;
  if (proportionValide >= 0.8) return "#146c43";
  if (proportionValide >= 0.5) return "#d97706";
  return "#dc2626";
}

function nomPays(tableauBord: TableauBordRegional | null, paysId: number, t: (cle: string) => string): string {
  return tableauBord?.par_pays.find((p) => p.pays_id === paysId)?.nom ?? `${t("commun.pays")} #${paysId}`;
}

function codeIsoPays(tableauBord: TableauBordRegional | null, paysId: number): string | undefined {
  return tableauBord?.par_pays.find((p) => p.pays_id === paysId)?.code_iso;
}

const CATEGORIES_EXPORT: { valeur: string; cle: string }[] = [
  { valeur: "commandes", cle: "nav.commandes" },
  { valeur: "paiements", cle: "nav.paiements" },
  { valeur: "passeports_emis", cle: "statistiques.export_emis" },
  { valeur: "controles", cle: "statistiques.export_controles" },
];

function FiltreEtTableauPaysAnnee({
  donnees,
  tableauBord,
  paysImpose,
}: {
  donnees: StatistiquesParPaysAnnee[];
  tableauBord: TableauBordRegional;
  paysImpose: number | null;
}) {
  const { t } = useI18n();
  const [filtrePaysId, setFiltrePaysId] = useState<number | "tous">(paysImpose ?? "tous");
  const [filtreAnnee, setFiltreAnnee] = useState<number | "toutes">("toutes");
  const [categoriesExport, setCategoriesExport] = useState<Set<string>>(new Set(CATEGORIES_EXPORT.map((c) => c.valeur)));
  const [exportEnCours, setExportEnCours] = useState(false);
  const [erreurExport, setErreurExport] = useState(false);

  const anneesDisponibles = Array.from(new Set(donnees.map((l) => l.annee))).sort((a, b) => b - a);

  const donneesFiltrees = donnees.filter(
    (l) => (filtrePaysId === "tous" || l.pays_id === filtrePaysId) && (filtreAnnee === "toutes" || l.annee === filtreAnnee)
  );

  const basculerCategorie = (valeur: string) => {
    setCategoriesExport((precedent) => {
      const copie = new Set(precedent);
      if (copie.has(valeur)) copie.delete(valeur);
      else copie.add(valeur);
      return copie;
    });
  };

  const exporter = async () => {
    setErreurExport(false);
    setExportEnCours(true);
    try {
      const params: Record<string, string | number> = { categories: Array.from(categoriesExport).join(",") || "tout" };
      if (filtrePaysId !== "tous") params.pays_id = filtrePaysId;
      if (filtreAnnee !== "toutes") params.annee = filtreAnnee;
      const { data } = await apiClient.get("/statistiques/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(
        new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = "statistiques-ppb.xlsx";
      lien.click();
      URL.revokeObjectURL(url);
    } catch {
      setErreurExport(true);
    } finally {
      setExportEnCours(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md bg-gray-50 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("commun.pays")}</label>
          <select
            value={filtrePaysId}
            disabled={paysImpose !== null}
            onChange={(e) => setFiltrePaysId(e.target.value === "tous" ? "tous" : Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
          >
            {paysImpose === null && <option value="tous">{t("statistiques.tous_pays")}</option>}
            {tableauBord.par_pays.map((p) => (
              <option key={p.pays_id} value={p.pays_id}>
                {p.nom}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("statistiques.annee")}</label>
          <select
            value={filtreAnnee}
            onChange={(e) => setFiltreAnnee(e.target.value === "toutes" ? "toutes" : Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="toutes">{t("statistiques.toutes_annees")}</option>
            {anneesDisponibles.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("statistiques.exporter")}</label>
          <div className="flex flex-wrap gap-3">
            {CATEGORIES_EXPORT.map((cat) => (
              <label key={cat.valeur} className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={categoriesExport.has(cat.valeur)} onChange={() => basculerCategorie(cat.valeur)} />
                {t(cat.cle)}
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={exporter}
          disabled={exportEnCours || categoriesExport.size === 0}
          className="rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
        >
          {exportEnCours ? t("statistiques.generation") : t("statistiques.exporter_excel")}
        </button>
      </div>
      {erreurExport && <p className="text-sm text-red-600">{t("statistiques.export_echoue")}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-or/40 text-xs text-gray-500">
              <th className="py-2 pr-4">{t("commun.pays")}</th>
              <th className="py-2 pr-4">{t("statistiques.annee")}</th>
              <th className="py-2 pr-4">{t("nav.commandes")}</th>
              <th className="py-2 pr-4">{t("statistiques.montant_commande")}</th>
              <th className="py-2 pr-4">{t("statistiques.montant_encaisse")}</th>
              <th className="py-2 pr-4">{t("statistiques.moyens_paiement")}</th>
              <th className="py-2 pr-4">{t("statistiques.vierge")}</th>
              <th className="py-2 pr-4">{t("statistiques.emis")}</th>
              <th className="py-2 pr-4">{t("statistiques.controle")}</th>
              <th className="py-2 pr-4 text-green-700">{t("statistiques.verifs_validees")}</th>
              <th className="py-2 pr-4 text-red-700">{t("statistiques.refusees")}</th>
              <th className="py-2 pr-4 text-amber-700">{t("statistiques.a_verifier")}</th>
            </tr>
          </thead>
          <tbody>
            {donneesFiltrees.map((ligne) => (
              <tr key={`${ligne.pays_id}-${ligne.annee}`} className="border-b border-gray-100">
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-1.5">
                    <DrapeauPays codeIso={codeIsoPays(tableauBord, ligne.pays_id)} />
                    {nomPays(tableauBord, ligne.pays_id, t)}
                  </span>
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{ligne.annee}</td>
                <td className="py-2 pr-4">{ligne.nb_commandes}</td>
                <td className="py-2 pr-4">{ligne.montant_commandes_xaf.toLocaleString("fr-FR")}</td>
                <td className="py-2 pr-4">{ligne.montant_encaisse_xaf.toLocaleString("fr-FR")}</td>
                <td className="py-2 pr-4 text-xs text-gray-500">
                  {Object.entries(ligne.moyens_paiement).length === 0
                    ? "—"
                    : Object.entries(ligne.moyens_paiement)
                        .map(([moyen, nb]) => `${LIBELLES_MOYEN_PAIEMENT_COURT[moyen] ?? moyen} : ${nb}`)
                        .join(" · ")}
                </td>
                <td className="py-2 pr-4">{ligne.passeports_par_statut.vierge ?? 0}</td>
                <td className="py-2 pr-4">{ligne.passeports_par_statut.emis ?? 0}</td>
                <td className="py-2 pr-4">{ligne.passeports_par_statut.controle ?? 0}</td>
                <td className="py-2 pr-4">{ligne.controles_par_resultat.valide ?? 0}</td>
                <td className="py-2 pr-4">{ligne.controles_par_resultat.refuse ?? 0}</td>
                <td className="py-2 pr-4">{ligne.controles_par_resultat.a_verifier ?? 0}</td>
              </tr>
            ))}
            {donneesFiltrees.length === 0 && (
              <tr>
                <td colSpan={12} className="py-4 text-center text-gray-400">
                  {t("statistiques.aucune_donnee")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Détail nominatif des émissions (éleveur/convoyeur, espèces, vaccinations) ---------------
// Réservé Super Admin / Admin National (voir garde de rôle sur l'appel de ce composant) — données
// personnelles (CNI, téléphone) jamais exposées à Consultation, à la différence des agrégats
// ci-dessus. Cloisonné par pays côté backend (GET /passeports/emissions-detail) ; `paysImpose`
// ne fait ici que refléter cette même règle dans l'interface, jamais l'imposer lui-même.

interface PaysOption {
  pays_id: number;
  code_iso: string;
  nom: string;
}

function SectionEmissionsDetail({ paysImpose, paysDisponibles }: { paysImpose: number | null; paysDisponibles: PaysOption[] }) {
  const { t } = useI18n();
  const [filtrePaysId, setFiltrePaysId] = useState<number | "tous">(paysImpose ?? "tous");
  const [filtreAnnee, setFiltreAnnee] = useState<number | "toutes">("toutes");
  const [emissions, setEmissions] = useState<DetailEmission[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const charger = () => {
    setChargement(true);
    setErreur(null);
    const params: Record<string, number> = { limite: 100 };
    if (filtrePaysId !== "tous") params.pays_id = filtrePaysId;
    if (filtreAnnee !== "toutes") params.annee = filtreAnnee;
    apiClient
      .get<DetailEmission[]>("/passeports/emissions-detail", { params })
      .then(({ data }) => setEmissions(data))
      .catch(() => setErreur(t("statistiques.erreur_emissions")))
      .finally(() => setChargement(false));
  };

  useEffect(charger, [filtrePaysId, filtreAnnee]);

  const nomPays = (paysId: number) => paysDisponibles.find((p) => p.pays_id === paysId)?.nom ?? `${t("commun.pays")} #${paysId}`;

  return (
    <section className="rounded-lg border border-or/40 bg-white p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-800">{t("statistiques.emissions_titre")}</h2>
        <p className="text-xs text-gray-500">{t("statistiques.emissions_intro")}</p>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md bg-gray-50 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("commun.pays")}</label>
          <select
            value={filtrePaysId}
            disabled={paysImpose !== null}
            onChange={(e) => setFiltrePaysId(e.target.value === "tous" ? "tous" : Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
          >
            {paysImpose === null && <option value="tous">{t("statistiques.tous_pays")}</option>}
            {paysDisponibles.map((p) => (
              <option key={p.pays_id} value={p.pays_id}>
                {p.nom}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("statistiques.annee")}</label>
          <input
            type="number"
            placeholder={t("statistiques.toutes_f")}
            value={filtreAnnee === "toutes" ? "" : filtreAnnee}
            onChange={(e) => setFiltreAnnee(e.target.value === "" ? "toutes" : Number(e.target.value))}
            className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      {chargement ? (
        <p className="text-sm text-gray-500">{t("commun.chargement")}</p>
      ) : emissions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
          {t("statistiques.aucune_emission")}
        </p>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-or/40">
          {emissions.map((e) => (
            <div key={e.id}>
              <button
                onClick={() => setOuverte(ouverte === e.id ? null : e.id)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-gray-50"
              >
                <span className="font-mono text-xs text-gray-700">{e.numero}</span>
                <span className="text-xs text-gray-500">
                  {nomPays(e.pays_id)} · {e.statut} · {t("statistiques.tetes", { n: e.nombre_total_animaux })}
                </span>
              </button>
              {ouverte === e.id && (
                <div className="grid grid-cols-1 gap-4 border-t border-gray-100 bg-gray-50 p-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-600">{t("page3.proprietaire")}</p>
                    {e.eleveur ? (
                      <p className="text-sm text-gray-800">
                        {e.eleveur.nom_prenom}
                        <br />
                        <span className="text-xs text-gray-500">
                          {t("statistiques.cni")} {e.eleveur.numero_cni} {e.eleveur.telephone && `· ${t("statistiques.tel")} ${e.eleveur.telephone}`}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">{t("statistiques.non_renseigne")}</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-600">{t("page3.convoyeur")}</p>
                    {e.convoyeur ? (
                      <p className="text-sm text-gray-800">
                        {e.convoyeur.nom_prenom}
                        <br />
                        <span className="text-xs text-gray-500">
                          {t("statistiques.cni")} {e.convoyeur.numero_cni} {e.convoyeur.telephone && `· ${t("statistiques.tel")} ${e.convoyeur.telephone}`}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">{t("statistiques.non_renseigne")}</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-600">{t("statistiques.especes")}</p>
                    {e.especes.length === 0 ? (
                      <p className="text-xs text-gray-400">{t("statistiques.aucune_donnee")}</p>
                    ) : (
                      <ul className="space-y-0.5 text-xs text-gray-700">
                        {e.especes.map((esp, i) => (
                          <li key={i}>
                            {esp.espece} — {t("statistiques.detail_effectif", {
                              total: esp.nombre_total,
                              males: esp.nombre_males,
                              fj: esp.nombre_femelles_jeunes,
                              fa: esp.nombre_femelles_adultes,
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-600">{t("page4.vaccinations")}</p>
                    {e.vaccinations.length === 0 ? (
                      <p className="text-xs text-gray-400">{t("statistiques.aucune_donnee")}</p>
                    ) : (
                      <ul className="space-y-0.5 text-xs text-gray-700">
                        {e.vaccinations.map((v, i) => (
                          <li key={i}>
                            {v.maladie} {v.date_vaccination && `— ${v.date_vaccination}`} {v.lieu && `(${v.lieu})`}{" "}
                            {v.valide ? <span className="text-green-700">{t("statistiques.validee")}</span> : <span className="text-amber-700">{t("statistiques.non_validee")}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
