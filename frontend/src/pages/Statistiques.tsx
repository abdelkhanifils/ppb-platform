import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import "leaflet/dist/leaflet.css";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/lib/i18n";
import { DrapeauPays } from "@/components/DrapeauPays";
import { BoutonsExport } from "@/components/BoutonsExport";
import { Role } from "@/types/roles";
import type { ClusterMouvements, ControleHistorique, DetailEmission, StatistiquesParPaysAnnee, StatistiquesParPoste, TableauBordRegional, VoyagePersonne } from "@/types/statistiques";
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
  const [filtrePaysPoste, setFiltrePaysPoste] = useState<number | "tous">("tous");
  const [posteSelectionneId, setPosteSelectionneId] = useState<string | "">("");
  const [filtrePaysEntonnoir, setFiltrePaysEntonnoir] = useState<number | "tous">(paysImpose ?? "tous");

  useEffect(() => {
    // Chaque section a sa propre gestion d'erreur : un souci sur l'une
    // (ex. la vue croisée pays/année, plus récente) ne doit jamais empêcher
    // l'affichage des autres, déjà éprouvées.
    Promise.all([
      apiClient.get<TableauBordRegional>("/statistiques/tableau-bord"),
      apiClient.get<{ clusters: ClusterMouvements[] }>("/statistiques/carte-mouvements"),
    ])
      .then(([bord, clustersReponse]) => {
        setTableauBord(bord.data);
        setClusters(clustersReponse.data.clusters);
      })
      .catch(() => setErreur(t("statistiques.erreur_chargement")))
      .finally(() => setChargement(false));

    apiClient
      .get<StatistiquesParPaysAnnee[]>("/statistiques/par-pays-annee")
      .then(({ data }) => setParPaysAnnee(data))
      .catch(() => setErreurParPaysAnnee(true));
  }, []);

  // Rechargé à chaque changement de pays (pas un simple filtrage côté
  // client sur une liste chargée une seule fois) : le backend attribue les
  // contrôles "orphelins" (poste_id saisi sur le terrain sans correspondance
  // exacte dans le référentiel) au pays de LEUR PROPRE passeport uniquement
  // quand un pays précis est demandé en paramètre — sans ce param, ils
  // ressortent avec pays_id=null et disparaissaient donc de tout filtre
  // client-side. Voir backend/app/services/statistiques.py::agreger_par_poste.
  useEffect(() => {
    const params = filtrePaysPoste === "tous" ? {} : { pays_id: filtrePaysPoste };
    apiClient
      .get<StatistiquesParPoste[]>("/statistiques/par-poste", { params })
      .then(({ data }) => setPostes(data))
      .catch(() => setPostes([]));
  }, [filtrePaysPoste]);

  if (chargement) return <p className="text-sm text-gray-500">{t("statistiques.chargement_tdb")}</p>;
  if (erreur || !tableauBord) return <p className="text-sm text-red-600">{erreur ?? t("statistiques.donnees_indisponibles")}</p>;

  // Global par défaut ; si un pays est choisi et que la vue croisée pays/année
  // a bien pu être chargée, on agrège ses statuts (toutes années confondues
  // pour ce pays) plutôt que d'appeler un endpoint séparé — la donnée est
  // déjà là.
  const paysEntonnoirIndisponible = filtrePaysEntonnoir !== "tous" && (erreurParPaysAnnee || !parPaysAnnee);
  const donneesEntonnoir = (() => {
    if (filtrePaysEntonnoir === "tous" || paysEntonnoirIndisponible) {
      return tableauBord.entonnoir_global.map((p) => ({
        phase: LIBELLES_PHASE[p.statut] ?? p.statut,
        nombre: p.nombre,
      }));
    }
    const cumul: Record<string, number> = {};
    for (const ligne of parPaysAnnee ?? []) {
      if (ligne.pays_id !== filtrePaysEntonnoir) continue;
      for (const [statut, nombre] of Object.entries(ligne.passeports_par_statut)) {
        cumul[statut] = (cumul[statut] ?? 0) + nombre;
      }
    }
    return Object.entries(cumul).map(([statut, nombre]) => ({
      phase: LIBELLES_PHASE[statut] ?? statut,
      nombre,
    }));
  })();

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">{t("statistiques.parcours_titre")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <BoutonsExport
              nomBase="parcours-passeports"
              titre={t("statistiques.parcours_titre")}
              colonnes={[
                { cle: "phase", titre: t("statistiques.etape") },
                { cle: "nombre", titre: t("statistiques.total") },
              ]}
              lignes={donneesEntonnoir}
            />
            <select
            value={filtrePaysEntonnoir}
            disabled={paysImpose !== null}
            onChange={(e) => setFiltrePaysEntonnoir(e.target.value === "tous" ? "tous" : Number(e.target.value))}
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
        </div>
        {paysEntonnoirIndisponible && (
          <p className="mb-2 text-xs text-amber-600">{t("statistiques.parcours_pays_indisponible")}</p>
        )}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">{t("statistiques.par_pays_titre")}</h2>
          <BoutonsExport
            nomBase="statistiques-par-pays"
            titre={t("statistiques.par_pays_titre")}
            colonnes={[
              { cle: "pays", titre: t("commun.pays") },
              { cle: "commandes", titre: t("nav.commandes") },
              { cle: "emis", titre: t("statistiques.emis") },
              { cle: "controle", titre: t("statistiques.controles") },
            ]}
            lignes={donneesParPays}
          />
        </div>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">{t("statistiques.par_poste_titre")}</h2>
          {postes.length > 0 && (
            <BoutonsExport
              nomBase="statistiques-par-poste"
              titre={t("statistiques.par_poste_titre")}
              colonnes={[
                { cle: "resultat", titre: t("statistiques.controles") },
                { cle: "nombre", titre: t("statistiques.total") },
              ]}
              lignes={(() => {
                const postesDuPays = filtrePaysPoste === "tous" ? postes : postes.filter((p) => p.pays_id === filtrePaysPoste);
                const posteAffiche = posteSelectionneId === "" ? null : postesDuPays.find((p) => p.poste_id === posteSelectionneId) ?? null;
                const source = posteAffiche
                  ? posteAffiche.controles_par_resultat
                  : {
                      valide: postesDuPays.reduce((s, p) => s + (p.controles_par_resultat.valide ?? 0), 0),
                      refuse: postesDuPays.reduce((s, p) => s + (p.controles_par_resultat.refuse ?? 0), 0),
                      a_verifier: postesDuPays.reduce((s, p) => s + (p.controles_par_resultat.a_verifier ?? 0), 0),
                    };
                return [
                  { resultat: t("statistiques.valides"), nombre: source.valide ?? 0 },
                  { resultat: t("statistiques.refusees"), nombre: source.refuse ?? 0 },
                  { resultat: t("statistiques.a_verifier"), nombre: source.a_verifier ?? 0 },
                ];
              })()}
            />
          )}
        </div>

        {postes.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">{t("statistiques.aucun_poste")}</p>
        ) : (
          (() => {
            // Pays d'abord, puis poste — le second sélecteur ne propose que
            // les postes du pays choisi. Un changement de pays réinitialise
            // le poste choisi à "Tous" (il n'appartient plus forcément au
            // nouveau filtre) plutôt que de garder une sélection incohérente.
            const postesDuPays = filtrePaysPoste === "tous" ? postes : postes.filter((p) => p.pays_id === filtrePaysPoste);
            // "" = Tous les postes (du pays choisi, ou de tous les pays si
            // aucun pays non plus) — état par défaut, jamais un poste précis
            // choisi automatiquement à la place de l'agrégat.
            const posteAffiche = posteSelectionneId === "" ? null : postesDuPays.find((p) => p.poste_id === posteSelectionneId) ?? null;
            const cumulTousPostes = {
              valide: postesDuPays.reduce((s, p) => s + (p.controles_par_resultat.valide ?? 0), 0),
              refuse: postesDuPays.reduce((s, p) => s + (p.controles_par_resultat.refuse ?? 0), 0),
              a_verifier: postesDuPays.reduce((s, p) => s + (p.controles_par_resultat.a_verifier ?? 0), 0),
              total: postesDuPays.reduce((s, p) => s + p.total_controles, 0),
            };
            const resultatsAffiches = posteAffiche
              ? {
                  valide: posteAffiche.controles_par_resultat.valide ?? 0,
                  refuse: posteAffiche.controles_par_resultat.refuse ?? 0,
                  a_verifier: posteAffiche.controles_par_resultat.a_verifier ?? 0,
                  total: posteAffiche.total_controles,
                }
              : cumulTousPostes;
            const donneesGraphique = [
              { resultat: t("statistiques.valides"), nombre: resultatsAffiches.valide },
              { resultat: t("statistiques.refusees"), nombre: resultatsAffiches.refuse },
              { resultat: t("statistiques.a_verifier"), nombre: resultatsAffiches.a_verifier },
            ];

            return (
              <>
                <div className="mb-4 flex flex-wrap gap-2">
                  <select
                    value={filtrePaysPoste}
                    onChange={(e) => {
                      setFiltrePaysPoste(e.target.value === "tous" ? "tous" : Number(e.target.value));
                      setPosteSelectionneId("");
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="tous">{t("statistiques.tous_pays")}</option>
                    {tableauBord.par_pays.map((p) => (
                      <option key={p.pays_id} value={p.pays_id}>
                        {p.nom}
                      </option>
                    ))}
                  </select>
                  <select
                    value={posteSelectionneId}
                    onChange={(e) => setPosteSelectionneId(e.target.value)}
                    className="min-w-[180px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">{t("statistiques.tous_postes")}</option>
                    {postesDuPays.map((p) => (
                      <option key={p.poste_id} value={p.poste_id}>
                        {p.nom}
                      </option>
                    ))}
                  </select>
                </div>

                {postesDuPays.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-400">{t("statistiques.aucun_poste")}</p>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-gray-500">
                      {t("statistiques.total")} : <span className="font-medium text-gray-800">{resultatsAffiches.total}</span>
                    </p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={donneesGraphique}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="resultat" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="nombre" fill="#0B6B3A" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                )}
              </>
            );
          })()
        )}
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

      <div className="mb-2 flex justify-end">
        <BoutonsExport
          nomBase="statistiques-pays-annee"
          titre={t("statistiques.detail_titre")}
          colonnes={[
            { cle: "pays", titre: t("commun.pays") },
            { cle: "annee", titre: t("statistiques.annee") },
            { cle: "commandes", titre: t("nav.commandes") },
            { cle: "montant_commande", titre: t("statistiques.montant_commande") },
            { cle: "montant_encaisse", titre: t("statistiques.montant_encaisse") },
            { cle: "vierge", titre: t("statistiques.vierge") },
            { cle: "emis", titre: t("statistiques.emis") },
            { cle: "controle", titre: t("statistiques.controle") },
            { cle: "valides", titre: t("statistiques.verifs_validees") },
            { cle: "refusees", titre: t("statistiques.refusees") },
          ]}
          lignes={donneesFiltrees.map((ligne) => ({
            pays: tableauBord.par_pays.find((p) => p.pays_id === ligne.pays_id)?.nom ?? `#${ligne.pays_id}`,
            annee: ligne.annee,
            commandes: ligne.nb_commandes,
            montant_commande: ligne.montant_commandes_xaf,
            montant_encaisse: ligne.montant_encaisse_xaf,
            vierge: ligne.passeports_par_statut.vierge ?? 0,
            emis: ligne.passeports_par_statut.emis ?? 0,
            controle: ligne.passeports_par_statut.controle ?? 0,
            valides: ligne.controles_par_resultat.valide ?? 0,
            refusees: ligne.controles_par_resultat.refuse ?? 0,
          }))}
        />
      </div>

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
  const { utilisateur } = useAuth();
  const estSuperAdmin = utilisateur?.role === Role.SUPER_ADMIN;
  const [filtrePaysId, setFiltrePaysId] = useState<number | "tous">(paysImpose ?? "tous");
  const [filtreAnnee, setFiltreAnnee] = useState<number | "toutes">("toutes");
  const [filtreProvince, setFiltreProvince] = useState("");
  const [filtreLocalite, setFiltreLocalite] = useState("");
  const [filtreRecherche, setFiltreRecherche] = useState("");
  const [emissions, setEmissions] = useState<DetailEmission[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);

  // Historique multi-passeports d'UNE personne (éleveur ou convoyeur),
  // regroupé par CNI — voir GET /passeports/historique-personne. `null` tant
  // qu'aucune personne n'a été cliquée ; distinct de `ouverte` ci-dessus
  // (qui ne concerne que le dépliage d'UNE ligne d'émission).
  const [personneOuverte, setPersonneOuverte] = useState<{ nom: string; cni: string } | null>(null);
  const [voyages, setVoyages] = useState<VoyagePersonne[]>([]);
  const [chargementVoyages, setChargementVoyages] = useState(false);

  const ouvrirHistoriquePersonne = (nom: string, cni: string) => {
    setPersonneOuverte({ nom, cni });
    setChargementVoyages(true);
    setVoyages([]);
    apiClient
      .get<VoyagePersonne[]>("/passeports/historique-personne", { params: { numero_cni: cni } })
      .then(({ data }) => setVoyages(data))
      .finally(() => setChargementVoyages(false));
  };

  const charger = () => {
    setChargement(true);
    setErreur(null);
    const params: Record<string, string | number> = { limite: 100 };
    if (filtrePaysId !== "tous") params.pays_id = filtrePaysId;
    if (filtreAnnee !== "toutes") params.annee = filtreAnnee;
    if (filtreProvince.trim()) params.province = filtreProvince.trim();
    if (filtreLocalite.trim()) params.localite = filtreLocalite.trim();
    if (filtreRecherche.trim()) params.recherche = filtreRecherche.trim();
    apiClient
      .get<DetailEmission[]>("/passeports/emissions-detail", { params })
      .then(({ data }) => setEmissions(data))
      .catch(() => setErreur(t("statistiques.erreur_emissions")))
      .finally(() => setChargement(false));
  };

  useEffect(charger, [filtrePaysId, filtreAnnee]);
  // Champs texte : différé de 400ms après la dernière frappe, pour éviter
  // une requête à chaque caractère saisi.
  useEffect(() => {
    const minuteur = setTimeout(charger, 400);
    return () => clearTimeout(minuteur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreProvince, filtreLocalite, filtreRecherche]);

  const nomPays = (paysId: number) => paysDisponibles.find((p) => p.pays_id === paysId)?.nom ?? `${t("commun.pays")} #${paysId}`;
  // Pour l'itinéraire spécifiquement : pays_*_id peut être `null` si le
  // trajet implique un pays hors CEMAC (voir backend/app/models/itineraire.py)
  // — le nom saisi librement (pays_*_autre) sert alors d'affichage.
  const nomPaysOuAutre = (paysId: number | null, autre: string | null) =>
    paysId === null ? autre || t("statistiques.non_renseigne") : nomPays(paysId);

  return (
    <>
    <section className="rounded-lg border border-or/40 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">{t("statistiques.emissions_titre")}</h2>
          <p className="text-xs text-gray-500">{t("statistiques.emissions_intro")}</p>
        </div>
        <BoutonsExport
          nomBase="detail-emissions"
          titre={t("statistiques.emissions_titre")}
          colonnes={[
            { cle: "numero", titre: t("recap.passeport") },
            { cle: "statut", titre: t("statistiques.statut") },
            { cle: "eleveur", titre: t("p3.eleveur") },
            { cle: "eleveur_cni", titre: t("statistiques.cni") },
            { cle: "convoyeur", titre: t("p3.convoyeur") },
            { cle: "cheptel", titre: t("statistiques.especes") },
            { cle: "origine", titre: t("p3.pays_origine") },
            { cle: "destination", titre: t("p3.pays_destination") },
          ]}
          lignes={emissions.map((e) => ({
            numero: e.numero,
            statut: e.statut,
            eleveur: e.eleveur?.nom_prenom ?? "",
            eleveur_cni: e.eleveur?.numero_cni ?? "",
            convoyeur: e.convoyeur?.nom_prenom ?? "",
            cheptel: e.nombre_total_animaux,
            origine: nomPaysOuAutre(e.itineraire?.pays_origine_id ?? null, e.itineraire?.pays_origine_autre ?? null),
            destination: nomPaysOuAutre(e.itineraire?.pays_destination_id ?? null, e.itineraire?.pays_destination_autre ?? null),
          }))}
        />
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
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("statistiques.province")}</label>
          <input
            type="text"
            placeholder={t("statistiques.province_placeholder")}
            value={filtreProvince}
            onChange={(e) => setFiltreProvince(e.target.value)}
            className="w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("statistiques.localite")}</label>
          <input
            type="text"
            placeholder={t("statistiques.localite_placeholder")}
            value={filtreLocalite}
            onChange={(e) => setFiltreLocalite(e.target.value)}
            className="w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("statistiques.recherche_personne")}</label>
          <input
            type="text"
            placeholder={t("statistiques.recherche_placeholder")}
            value={filtreRecherche}
            onChange={(e) => setFiltreRecherche(e.target.value)}
            className="w-52 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
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
                        {estSuperAdmin ? (
                          <button
                            onClick={() => ouvrirHistoriquePersonne(e.eleveur!.nom_prenom, e.eleveur!.numero_cni)}
                            className="text-left font-medium text-cebevirha underline decoration-dotted underline-offset-2 hover:text-cebevirha-light"
                          >
                            {e.eleveur.nom_prenom}
                          </button>
                        ) : (
                          e.eleveur.nom_prenom
                        )}
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
                        {estSuperAdmin ? (
                          <button
                            onClick={() => ouvrirHistoriquePersonne(e.convoyeur!.nom_prenom, e.convoyeur!.numero_cni)}
                            className="text-left font-medium text-cebevirha underline decoration-dotted underline-offset-2 hover:text-cebevirha-light"
                          >
                            {e.convoyeur.nom_prenom}
                          </button>
                        ) : (
                          e.convoyeur.nom_prenom
                        )}
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
                    <p className="mb-1 text-xs font-semibold text-gray-600">{t("statistiques.itineraire")}</p>
                    {e.itineraire ? (
                      <div className="space-y-1 text-xs text-gray-700">
                        <p>
                          <span className="font-medium text-gray-600">{t("p3.pays_origine")} :</span>{" "}
                          {nomPaysOuAutre(e.itineraire.pays_origine_id, e.itineraire.pays_origine_autre)}
                          {" · "}
                          {e.itineraire.province_origine}
                          {e.itineraire.localite_origine && ` · ${e.itineraire.localite_origine}`}
                        </p>
                        <p>
                          <span className="font-medium text-gray-600">{t("p3.pays_destination")} :</span>{" "}
                          {nomPaysOuAutre(e.itineraire.pays_destination_id, e.itineraire.pays_destination_autre)}
                          {" · "}
                          {e.itineraire.province_destination}
                          {e.itineraire.localite_destination && ` · ${e.itineraire.localite_destination}`}
                        </p>
                      </div>
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

      {personneOuverte && (
        <ModalHistoriquePersonne
          personne={personneOuverte}
          voyages={voyages}
          chargement={chargementVoyages}
          onFermer={() => setPersonneOuverte(null)}
        />
      )}
    </>
  );
}

// Postes affichés par leur code brut faute de référentiel chargé ici
// (voir /passeports/historique-personne::_serialiser côté backend, qui
// renvoie poste_id tel quel) — acceptable pour cette vue ponctuelle.
function ModalHistoriquePersonne({
  personne,
  voyages,
  chargement,
  onFermer,
}: {
  personne: { nom: string; cni: string };
  voyages: VoyagePersonne[];
  chargement: boolean;
  onFermer: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFermer}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">{personne.nom}</h3>
            <p className="text-xs text-gray-500">
              {t("statistiques.cni")} {personne.cni} — {t("statistiques.historique_personne_intro")}
            </p>
          </div>
          <button onClick={onFermer} className="text-gray-400 hover:text-gray-600" aria-label={t("commun.fermer")}>
            ✕
          </button>
        </div>

        {chargement ? (
          <p className="text-sm text-gray-500">{t("commun.chargement")}</p>
        ) : voyages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            {t("statistiques.aucun_voyage")}
          </p>
        ) : (
          <div className="space-y-4">
            {voyages.map((v) => (
              <div key={v.passeport.id} className="rounded-md border border-or/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-700">{v.passeport.numero}</span>
                  <span className="text-xs text-gray-500">{v.passeport.statut}</span>
                </div>
                {v.passeport.itineraire && (
                  <p className="mb-2 text-xs text-gray-600">
                    {v.passeport.itineraire.province_origine} → {v.passeport.itineraire.province_destination}
                  </p>
                )}
                <p className="mb-1 text-xs font-semibold text-gray-600">{t("statistiques.controles_effectues")}</p>
                {v.controles.length === 0 ? (
                  <p className="text-xs text-gray-400">{t("statistiques.aucun_controle")}</p>
                ) : (
                  <ul className="space-y-0.5 text-xs text-gray-700">
                    {v.controles.map((c: ControleHistorique, i: number) => (
                      <li key={i}>
                        {new Date(c.date).toLocaleString("fr-FR")} — {c.poste_id} —{" "}
                        <span className={c.resultat === "valide" ? "text-green-700" : "text-amber-700"}>{c.resultat}</span>
                        {c.motif && <span className="text-gray-500"> ({c.motif})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
