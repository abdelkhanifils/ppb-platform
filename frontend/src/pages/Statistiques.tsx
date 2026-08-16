import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import "leaflet/dist/leaflet.css";
import { apiClient } from "@/api/client";
import type { ClusterMouvements, StatistiquesParPaysAnnee, StatistiquesParPoste, TableauBordRegional } from "@/types/statistiques";
import { LIBELLES_MOYEN_PAIEMENT_COURT, LIBELLES_PHASE } from "@/types/statistiques";

/**
 * Tableau de bord régional (Module transversal Statistiques) — trois axes :
 * par pays, par phase (entonnoir du pipeline M3->M5) et par poste, plus une
 * carte des mouvements de contrôle (clusters PostGIS en production — voir
 * backend/app/services/geospatial.py, repli portable en développement).
 */
export default function Statistiques() {
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
      .catch(() => setErreur("Impossible de charger le tableau de bord."))
      .finally(() => setChargement(false));

    apiClient
      .get<StatistiquesParPaysAnnee[]>("/statistiques/par-pays-annee")
      .then(({ data }) => setParPaysAnnee(data))
      .catch(() => setErreurParPaysAnnee(true));
  }, []);

  if (chargement) return <p className="text-sm text-gray-500">Chargement du tableau de bord…</p>;
  if (erreur || !tableauBord) return <p className="text-sm text-red-600">{erreur ?? "Données indisponibles."}</p>;

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
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tableau de bord régional</h1>
        <p className="text-sm text-gray-500">
          {tableauBord.totaux.nb_pays} pays · {tableauBord.totaux.nb_commandes_total} commandes ·{" "}
          {tableauBord.totaux.montant_encaisse_total_xaf.toLocaleString("fr-FR")} XAF encaissés
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Entonnoir global — par phase du pipeline</h2>
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

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Par pays — commandes et passeports émis/contrôlés</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={donneesParPays}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="pays" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="commandes" name="Commandes" fill="#146c43" radius={[4, 4, 0, 0]} />
            <Bar dataKey="emis" name="Émis" fill="#5c9e78" radius={[4, 4, 0, 0]} />
            <Bar dataKey="controle" name="Contrôlés" fill="#9dc6ac" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Par poste de contrôle</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="py-2 pr-4">Poste</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4 text-green-700">Validés</th>
                <th className="py-2 pr-4 text-red-700">Refusés</th>
                <th className="py-2 pr-4 text-amber-700">À vérifier</th>
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
                    Aucun poste référencé pour l'instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-800">Détail par pays et par année</h2>
        <p className="mb-3 text-xs text-gray-500">
          Commandes, paiements (par moyen), passeports imprimés et contrôles (par résultat) — l'année retenue est
          celle de la commande/du paiement, ou celle du numéro du PPB pour l'impression et le contrôle.
        </p>
        {erreurParPaysAnnee ? (
          <p className="text-sm text-red-600">Cette section n'a pas pu être chargée — le reste du tableau de bord reste disponible.</p>
        ) : parPaysAnnee === null ? (
          <p className="text-sm text-gray-500">Chargement…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="py-2 pr-4">Pays</th>
                  <th className="py-2 pr-4">Année</th>
                  <th className="py-2 pr-4">Commandes</th>
                  <th className="py-2 pr-4">Montant commandé</th>
                  <th className="py-2 pr-4">Montant encaissé</th>
                  <th className="py-2 pr-4">Moyens de paiement</th>
                  <th className="py-2 pr-4">PPB imprimés</th>
                  <th className="py-2 pr-4 text-green-700">Contrôles validés</th>
                  <th className="py-2 pr-4 text-red-700">Refusés</th>
                  <th className="py-2 pr-4 text-amber-700">À vérifier</th>
                </tr>
              </thead>
              <tbody>
                {parPaysAnnee.map((ligne) => (
                  <tr key={`${ligne.pays_id}-${ligne.annee}`} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{nomPays(tableauBord, ligne.pays_id)}</td>
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
                    <td className="py-2 pr-4">{ligne.nb_passeports_imprimes}</td>
                    <td className="py-2 pr-4">{ligne.controles_par_resultat.valide ?? 0}</td>
                    <td className="py-2 pr-4">{ligne.controles_par_resultat.refuse ?? 0}</td>
                    <td className="py-2 pr-4">{ligne.controles_par_resultat.a_verifier ?? 0}</td>
                  </tr>
                ))}
                {parPaysAnnee.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-4 text-center text-gray-400">
                      Aucune donnée pour l'instant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Carte des mouvements — clusters de contrôle</h2>
        <p className="mb-3 text-xs text-gray-500">
          Regroupement géospatial (PostGIS en production) des contrôles enregistrés. Taille du cercle proportionnelle
          au volume ; couleur selon la proportion de résultats validés.
        </p>
        {clusters.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            Aucun contrôle géolocalisé pour l'instant.
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
                    <p className="font-medium">{cluster.nombre} contrôle(s)</p>
                    <p>Validés : {cluster.valides}</p>
                    <p>Refusés : {cluster.refuses}</p>
                    <p>À vérifier : {cluster.a_verifier}</p>
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

function nomPays(tableauBord: TableauBordRegional | null, paysId: number): string {
  return tableauBord?.par_pays.find((p) => p.pays_id === paysId)?.nom ?? `Pays #${paysId}`;
}
